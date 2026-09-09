/**
 * Isolated verification of an encrypted backup before an operator replaces a
 * live database. The live file is never opened for writing: decryption,
 * integrity checks and forward migrations all run in a new temporary folder.
 */
import "server-only";

import { basename, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import Database from "better-sqlite3";

import { parseArtifactName } from "./artifact";
import {
  decryptFile,
  readEncryptionKey,
  type EncryptionErrorCode,
} from "./encryption";
import { verifySnapshot } from "./snapshot";
import { openSqliteConnection } from "../database";
import { applyMigrations, DEFAULT_MIGRATIONS_FOLDER } from "../migrate";
import { loadAppConfig, type EnvSource } from "../config";

/** Values compared before and after the isolated schema upgrade. */
export interface RestoreBusinessShape {
  readonly transactions: number;
  readonly transactionTags: number;
  readonly transactionTotalMinor: number;
  readonly recurringRules: number;
  readonly recurringOccurrences: number;
}

/** Closed reasons that are safe to print from the verification command. */
export type RestoreVerificationErrorCode =
  | "invalidArtifactName"
  | "invalidConfiguration"
  | "snapshotCorrupt"
  | "migrationFailed"
  | "businessDataChanged"
  | EncryptionErrorCode;

/** Result of checking a backup in an isolated temporary directory. */
export type RestoreVerificationResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly migrationsApplied: readonly string[];
        readonly shape: RestoreBusinessShape;
      };
    }
  | { readonly ok: false; readonly error: RestoreVerificationErrorCode };

/**
 * Decrypts and validates an artifact without reading or replacing the live
 * database. Any required forward migration is applied only to the temporary
 * restored copy, which also proves the artifact's schema is compatible.
 */
export async function verifyRestoreArtifact(
  artifactPath: string,
  source: EnvSource = process.env,
): Promise<RestoreVerificationResult> {
  const artifactName = basename(artifactPath);

  if (parseArtifactName(artifactName) === null) {
    return { ok: false, error: "invalidArtifactName" };
  }

  const config = loadAppConfig(source);

  if (!config.ok) {
    return { ok: false, error: "invalidConfiguration" };
  }

  const keyFilePath = source.BACKUP_ENCRYPTION_KEY_FILE;

  if (keyFilePath === undefined || keyFilePath.trim() === "") {
    return { ok: false, error: "keyFileUnreadable" };
  }

  const key = await readEncryptionKey(keyFilePath);

  if (!key.ok) {
    return { ok: false, error: key.error };
  }

  const directory = await mkdtemp(join(tmpdir(), "pft-restore-"));
  const restoredPath = join(directory, "restored.sqlite");

  try {
    const decrypted = await decryptFile(
      artifactPath,
      restoredPath,
      key.value,
      artifactName,
    );

    if (!decrypted.ok) {
      return { ok: false, error: decrypted.error };
    }

    if (!verifySnapshot(restoredPath)) {
      return { ok: false, error: "snapshotCorrupt" };
    }

    const before = readBusinessShape(restoredPath);
    const opened = openSqliteConnection({
      ...config.value,
      databasePath: restoredPath,
    });

    if (!opened.ok) {
      return { ok: false, error: "migrationFailed" };
    }

    const migrated = applyMigrations(opened.value, DEFAULT_MIGRATIONS_FOLDER);
    opened.value.close();

    if (!migrated.ok || !verifySnapshot(restoredPath)) {
      return { ok: false, error: "migrationFailed" };
    }

    const after = readBusinessShape(restoredPath);

    if (!sameBusinessShape(before, after)) {
      return { ok: false, error: "businessDataChanged" };
    }

    return {
      ok: true,
      value: { migrationsApplied: migrated.value.applied, shape: after },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readBusinessShape(databasePath: string): RestoreBusinessShape {
  const database = new Database(databasePath, { readonly: true });

  try {
    return {
      transactions: readCount(database, '"transaction"'),
      transactionTags: readCount(database, "transaction_tag"),
      transactionTotalMinor: readTotal(database),
      recurringRules: readOptionalCount(database, "recurring_rule"),
      recurringOccurrences: readOptionalCount(database, "recurring_occurrence"),
    };
  } finally {
    database.close();
  }
}

function readCount(database: Database.Database, table: string): number {
  return (
    database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
      readonly total: number;
    }
  ).total;
}

function readOptionalCount(database: Database.Database, table: string): number {
  const exists = database
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(table);

  return exists === undefined ? 0 : readCount(database, table);
}

function readTotal(database: Database.Database): number {
  const result = database
    .prepare(
      'SELECT COALESCE(SUM(amount_minor), 0) AS total FROM "transaction"',
    )
    .get() as { readonly total: number };

  return result.total;
}

function sameBusinessShape(
  before: RestoreBusinessShape,
  after: RestoreBusinessShape,
): boolean {
  return (
    before.transactions === after.transactions &&
    before.transactionTags === after.transactionTags &&
    before.transactionTotalMinor === after.transactionTotalMinor &&
    before.recurringRules === after.recurringRules &&
    before.recurringOccurrences === after.recurringOccurrences
  );
}
