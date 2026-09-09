/**
 * Disaster-rehearsal checks for isolated restore verification.
 *
 * Every artifact, database and key is created under a temporary directory with
 * fictitious rows. These tests prove a corrupt or incompatible backup cannot
 * reach replacement because verification fails before an operator's separate,
 * explicitly authorised replacement procedure.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { formatArtifactName } from "../../../src/shared/server/backup/artifact";
import { encryptFile } from "../../../src/shared/server/backup/encryption";
import {
  verifyRestoreArtifact,
  type RestoreBusinessShape,
} from "../../../src/shared/server/backup/restore-verification";
import { createConsistentSnapshot } from "../../../src/shared/server/backup/snapshot";
import {
  applyMigrations,
  DEFAULT_MIGRATIONS_FOLDER,
  SCHEMA_MIGRATION_TABLE,
} from "../../../src/shared/server/migrate";
import {
  createBackupEnv,
  createBackupWorkspace,
  createPopulatedDatabase,
  insertMovement,
  openDatabase,
  type BackupWorkspace,
} from "../helpers/backup";
import {
  COMMITTED_MIGRATION_TAGS,
  createTemporaryMigrationFolder,
  writeMigrationJournal,
} from "../helpers/migrations";

const workspaces: BackupWorkspace[] = [];
const cleanups: Array<{ cleanup(): void }> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.cleanup();
  }
  while (workspaces.length > 0) {
    workspaces.pop()?.cleanup();
  }
});

function createWorkspace(): BackupWorkspace {
  const workspace = createBackupWorkspace();
  workspaces.push(workspace);
  return workspace;
}

async function createArtifact(
  workspace: BackupWorkspace,
  sourcePath: string,
): Promise<string> {
  const artifactName = formatArtifactName(new Date("2026-04-10T02:00:00Z"));
  const snapshotPath = join(workspace.directory, "snapshot.sqlite");

  expect(createConsistentSnapshot(sourcePath, snapshotPath).ok).toBe(true);
  expect(
    (
      await encryptFile(
        snapshotPath,
        join(workspace.directory, artifactName),
        workspace.key,
        artifactName,
      )
    ).ok,
  ).toBe(true);

  return join(workspace.directory, artifactName);
}

function readLiveShape(workspace: BackupWorkspace): RestoreBusinessShape {
  const connection = openDatabase(workspace.databasePath);

  try {
    const total = connection.sqlite
      .prepare(
        'SELECT COALESCE(SUM(amount_minor), 0) AS total FROM "transaction"',
      )
      .get() as { readonly total: number };

    return {
      transactions: (
        connection.sqlite
          .prepare('SELECT COUNT(*) AS total FROM "transaction"')
          .get() as { readonly total: number }
      ).total,
      transactionTags: (
        connection.sqlite
          .prepare("SELECT COUNT(*) AS total FROM transaction_tag")
          .get() as { readonly total: number }
      ).total,
      transactionTotalMinor: total.total,
      recurringRules: 0,
      recurringOccurrences: 0,
    };
  } finally {
    connection.close();
  }
}

describe("isolated restore verification", () => {
  it("rejects a corrupt artifact and leaves the live target unchanged", async () => {
    const workspace = createWorkspace();
    const { workspaceId } = createPopulatedDatabase(workspace.databasePath);
    const source = openDatabase(workspace.databasePath);
    insertMovement(source, workspaceId, 0);
    source.close();
    const artifactPath = await createArtifact(
      workspace,
      workspace.databasePath,
    );
    const bytes = readFileSync(artifactPath);
    bytes[bytes.byteLength - 1] ^= 0xff;
    writeFileSync(artifactPath, bytes);
    const before = readLiveShape(workspace);

    await expect(
      verifyRestoreArtifact(artifactPath, createBackupEnv(workspace)),
    ).resolves.toEqual({ ok: false, error: "decryptFailed" });
    expect(readLiveShape(workspace)).toEqual(before);
  });

  it("validates integrity, schema compatibility and business counts in isolation", async () => {
    const workspace = createWorkspace();
    const { workspaceId } = createPopulatedDatabase(workspace.databasePath);
    const source = openDatabase(workspace.databasePath);
    for (let index = 0; index < 3; index += 1) {
      insertMovement(source, workspaceId, index);
    }
    source.close();
    const artifactPath = await createArtifact(
      workspace,
      workspace.databasePath,
    );
    const before = readLiveShape(workspace);

    await expect(
      verifyRestoreArtifact(artifactPath, createBackupEnv(workspace)),
    ).resolves.toEqual({
      ok: true,
      value: { migrationsApplied: [], shape: before },
    });
    expect(readLiveShape(workspace)).toEqual(before);
  });

  it("rehearses a compatible rollback artifact by forward-migrating only its copy", async () => {
    const workspace = createWorkspace();
    createPopulatedDatabase(workspace.databasePath);
    const legacyPath = join(workspace.directory, "legacy.sqlite");
    const migrationFolder = createTemporaryMigrationFolder();
    cleanups.push(migrationFolder);
    const legacyTags = [
      "0000_workspace_and_preference",
      "0001_classification_and_transactions",
      "0002_require_integer_amount_minor",
    ];

    writeMigrationJournal(
      migrationFolder.folder,
      legacyTags.map((tag) => ({
        tag,
        sql: readFileSync(
          join(DEFAULT_MIGRATIONS_FOLDER, `${tag}.sql`),
          "utf8",
        ),
      })),
    );

    const legacy = openDatabase(legacyPath);
    expect(applyMigrations(legacy, migrationFolder.folder).ok).toBe(true);
    legacy.sqlite
      .prepare("INSERT INTO workspace (id, kind, created_at) VALUES (?, ?, ?)")
      .run("legacy-workspace", "personal", 1);
    legacy.sqlite
      .prepare(
        "INSERT INTO category (id, workspace_id, name, normalized_name, type, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "legacy-category",
        "legacy-workspace",
        "Fixture",
        "fixture",
        "expense",
        0,
      );
    legacy.sqlite
      .prepare(
        `INSERT INTO "transaction" (
          id, workspace_id, type, amount_minor, date, category_id, created_at, updated_at
        ) VALUES (?, ?, 'expense', ?, '2026-04-01', ?, 1, 1)`,
      )
      .run("legacy-transaction", "legacy-workspace", 2500, "legacy-category");
    legacy.close();
    const artifactPath = await createArtifact(workspace, legacyPath);

    await expect(
      verifyRestoreArtifact(artifactPath, createBackupEnv(workspace)),
    ).resolves.toEqual({
      ok: true,
      value: {
        migrationsApplied: [...COMMITTED_MIGRATION_TAGS.slice(3)],
        shape: {
          transactions: 1,
          transactionTags: 0,
          transactionTotalMinor: 2500,
          recurringRules: 0,
          recurringOccurrences: 0,
        },
      },
    });
  });

  it("rejects an incompatible migration journal before any live replacement", async () => {
    const workspace = createWorkspace();
    createPopulatedDatabase(workspace.databasePath);
    const source = openDatabase(workspace.databasePath);
    source.sqlite
      .prepare(`UPDATE ${SCHEMA_MIGRATION_TABLE} SET hash = ? WHERE tag = ?`)
      .run("tampered-migration-hash", "0003_recurring_rules_and_occurrences");
    source.close();
    const artifactPath = await createArtifact(
      workspace,
      workspace.databasePath,
    );
    const before = readLiveShape(workspace);

    await expect(
      verifyRestoreArtifact(artifactPath, createBackupEnv(workspace)),
    ).resolves.toEqual({ ok: false, error: "migrationFailed" });
    expect(readLiveShape(workspace)).toEqual(before);
  });
});
