/**
 * Consistent SQLite snapshot taken while the application keeps writing.
 *
 * `VACUUM INTO` asks SQLite itself to write a complete, defragmented copy of
 * the committed state inside a read transaction. The main file and its
 * write-ahead log are never copied at the byte level, so a snapshot can never
 * contain a half-applied transaction. The same busy timeout as the application
 * absorbs the brief contention with a concurrent writer.
 */

import "server-only";

import { statSync } from "node:fs";

import Database from "better-sqlite3";

import { SQLITE_BUSY_TIMEOUT_MS } from "../database";

/** Reason why a snapshot could not be produced or trusted. */
export type SnapshotErrorCode =
  "sourceUnavailable" | "snapshotFailed" | "snapshotCorrupt";

/** Outcome of taking a snapshot. */
export type SnapshotResult =
  | { readonly ok: true; readonly value: { readonly byteLength: number } }
  | { readonly ok: false; readonly error: SnapshotErrorCode };

/**
 * Writes a consistent copy of `databasePath` to `snapshotPath`.
 *
 * The snapshot is verified before it is reported as usable: a copy that fails
 * `integrity_check` or `foreign_key_check` is a failure, not a backup.
 * `snapshotPath` must not exist yet, which keeps a previous run from being
 * silently overwritten.
 */
export function createConsistentSnapshot(
  databasePath: string,
  snapshotPath: string,
): SnapshotResult {
  let source: Database.Database;

  try {
    source = new Database(databasePath, {
      timeout: SQLITE_BUSY_TIMEOUT_MS,
      fileMustExist: true,
    });
  } catch {
    return { ok: false, error: "sourceUnavailable" };
  }

  try {
    source.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    source.prepare("VACUUM INTO ?").run(snapshotPath);
  } catch {
    return { ok: false, error: "snapshotFailed" };
  } finally {
    source.close();
  }

  if (!verifySnapshot(snapshotPath)) {
    return { ok: false, error: "snapshotCorrupt" };
  }

  return { ok: true, value: { byteLength: statSync(snapshotPath).size } };
}

/**
 * Reports whether a SQLite file passes the structural checks a restore needs.
 *
 * Exported because a restore rehearsal has to apply the same verification to
 * a decrypted artifact before it may replace anything.
 */
export function verifySnapshot(snapshotPath: string): boolean {
  let snapshot: Database.Database;

  try {
    snapshot = new Database(snapshotPath, {
      readonly: true,
      fileMustExist: true,
    });
  } catch {
    return false;
  }

  try {
    const integrity = snapshot.pragma("integrity_check") as ReadonlyArray<{
      readonly integrity_check: string;
    }>;
    const foreignKeys = snapshot.pragma("foreign_key_check") as ReadonlyArray<
      Record<string, unknown>
    >;

    return (
      integrity.length === 1 &&
      integrity[0].integrity_check === "ok" &&
      foreignKeys.length === 0
    );
  } catch {
    return false;
  } finally {
    snapshot.close();
  }
}
