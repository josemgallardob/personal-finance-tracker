/**
 * Real-file helpers for the encrypted backup integration tests.
 *
 * Everything here builds isolated temporary material: a migrated database with
 * real rows, an owner-only key file and a temporary destination directory.
 * Nothing stubs SQLite, the cipher or the destination, so the tests exercise
 * the same code the scheduled command runs.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BACKUP_DESTINATION_URI_ENV,
  BACKUP_ENCRYPTION_KEY_FILE_ENV,
  BACKUP_PATH_ENV,
} from "../../../src/shared/server/backup/config";
import { ENCRYPTION_KEY_BYTES } from "../../../src/shared/server/backup/encryption";
import {
  loadAppConfig,
  type EnvSource,
} from "../../../src/shared/server/config";
import {
  openSqliteConnection,
  type SqliteConnection,
} from "../../../src/shared/server/database";
import { initializeDatabase } from "../../../src/shared/server/initialize";
import { createValidAppEnv } from "./sqlite";

/** Identifiers of the rows every populated fixture database contains. */
export const FIXTURE_CATEGORY_ID = "category-groceries";

/** Identifier of the tag associated with every fixture movement. */
export const FIXTURE_TAG_ID = "tag-household";

/** Isolated working area for one backup test. */
export interface BackupWorkspace {
  readonly directory: string;
  readonly databasePath: string;
  readonly stagingPath: string;
  readonly destinationPath: string;
  readonly keyFilePath: string;
  readonly key: Buffer;
  cleanup(): void;
}

/** Creates the directories, database path and owner-only key file. */
export function createBackupWorkspace(): BackupWorkspace {
  const directory = mkdtempSync(join(tmpdir(), "pft-backup-"));
  const keyFilePath = join(directory, "backup.key");
  const key = randomBytes(ENCRYPTION_KEY_BYTES);

  writeFileSync(keyFilePath, `${key.toString("base64")}\n`, { mode: 0o600 });
  chmodSync(keyFilePath, 0o600);

  return {
    directory,
    databasePath: join(directory, "personal-finance.sqlite"),
    stagingPath: join(directory, "staging"),
    destinationPath: join(directory, "destination"),
    keyFilePath,
    key,
    cleanup(): void {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Environment map that satisfies both the app and the backup configuration. */
export function createBackupEnv(
  workspace: BackupWorkspace,
  overrides: EnvSource = {},
): EnvSource {
  return createValidAppEnv(workspace.databasePath, {
    [BACKUP_PATH_ENV]: workspace.stagingPath,
    [BACKUP_DESTINATION_URI_ENV]: pathToFileURL(workspace.destinationPath).href,
    [BACKUP_ENCRYPTION_KEY_FILE_ENV]: workspace.keyFilePath,
    ...overrides,
  });
}

/** Opens a real connection with the production PRAGMAs. */
export function openDatabase(filePath: string): SqliteConnection {
  const config = loadAppConfig(createValidAppEnv(filePath));

  if (!config.ok) {
    throw new Error("test environment is not a valid application config");
  }

  const opened = openSqliteConnection(config.value);

  if (!opened.ok) {
    throw new Error(`test database could not be opened: ${opened.error.code}`);
  }

  return opened.value;
}

/**
 * Migrates a fresh file and inserts the classification rows the movements of
 * the concurrent writer reference.
 *
 * Returns the workspace identifier so callers can insert their own rows with
 * the real foreign keys enabled.
 */
export function createPopulatedDatabase(filePath: string): {
  readonly workspaceId: string;
} {
  const connection = openDatabase(filePath);

  try {
    const initialized = initializeDatabase(connection, { now: () => 1 });

    if (!initialized.ok) {
      throw new Error("test database could not be initialized");
    }

    const { workspaceId } = initialized.value;

    connection.sqlite
      .prepare(
        `INSERT INTO category
           (id, workspace_id, name, normalized_name, type, sort_order)
         VALUES (?, ?, 'Compra', 'compra', 'expense', 900)`,
      )
      .run(FIXTURE_CATEGORY_ID, workspaceId);
    connection.sqlite
      .prepare(
        `INSERT INTO tag (id, workspace_id, name, normalized_name)
         VALUES (?, ?, 'Hogar', 'hogar')`,
      )
      .run(FIXTURE_TAG_ID, workspaceId);

    return { workspaceId };
  } finally {
    connection.close();
  }
}

/** Inserts one movement and its tag association inside a single transaction. */
export function insertMovement(
  connection: SqliteConnection,
  workspaceId: string,
  index: number,
): void {
  const identifier = `transaction-${String(index).padStart(6, "0")}`;

  connection.sqlite.transaction(() => {
    connection.sqlite
      .prepare(
        `INSERT INTO "transaction"
           (id, workspace_id, type, amount_minor, date, category_id,
            created_at, updated_at)
         VALUES (?, ?, 'expense', ?, '2026-03-04', ?, ?, ?)`,
      )
      .run(identifier, workspaceId, index + 1, FIXTURE_CATEGORY_ID, 1, 1);
    connection.sqlite
      .prepare(
        `INSERT INTO transaction_tag (transaction_id, tag_id, workspace_id)
         VALUES (?, ?, ?)`,
      )
      .run(identifier, FIXTURE_TAG_ID, workspaceId);
  })();
}
