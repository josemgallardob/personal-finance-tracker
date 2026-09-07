/**
 * Lazy server-only SQLite connection.
 *
 * The application keeps a single process and opens at most one connection. The
 * file is opened on first use, never at import time and never during
 * `next build`, so a production build does not need a database file. Each
 * connection enables WAL, foreign keys and a bounded busy timeout.
 */

import "server-only";

import { existsSync, statSync } from "node:fs";

import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";

import {
  type AppConfig,
  type AppConfigError,
  type EnvSource,
  loadAppConfig,
} from "./config";

/** Busy-wait budget applied to every connection, in milliseconds. */
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

/** Next.js production-build phase. Opening SQLite in this phase is forbidden. */
export const NEXT_PRODUCTION_BUILD_PHASE = "phase-production-build";

/** Reason why a database connection could not be opened. */
export type DatabaseErrorCode =
  "invalidConfig" | "invalidPath" | "openFailed" | "buildTimeAccess";

/** Controlled failure while reading configuration or opening SQLite. */
export interface DatabaseError {
  readonly code: DatabaseErrorCode;
  readonly path?: string;
  readonly configErrors?: readonly AppConfigError[];
  readonly cause?: string;
}

/** Open SQLite file wrapped for Drizzle and for a safe close. */
export interface SqliteConnection {
  readonly filePath: string;
  readonly sqlite: Database.Database;
  readonly db: BetterSQLite3Database;
  close(): void;
}

/** Outcome of opening or resolving the process connection. */
export type DatabaseResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: DatabaseError };

let activeConnection: SqliteConnection | undefined;

/**
 * Opens a real SQLite file with the production PRAGMAs.
 *
 * The caller supplies an already validated {@link AppConfig}. This function
 * does not read environment variables and does not keep a process-wide
 * singleton, so integration tests can open isolated temporary files.
 */
export function openSqliteConnection(
  config: AppConfig,
): DatabaseResult<SqliteConnection> {
  const filePath = config.databasePath;

  if (isExistingDirectory(filePath)) {
    return {
      ok: false,
      error: { code: "invalidPath", path: filePath },
    };
  }

  let sqlite: Database.Database;

  try {
    sqlite = new Database(filePath, { timeout: SQLITE_BUSY_TIMEOUT_MS });
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "openFailed",
        path: filePath,
        cause: errorMessage(cause),
      },
    };
  }

  try {
    applyConnectionPragmas(sqlite);
  } catch (cause) {
    closeSqlite(sqlite);
    return {
      ok: false,
      error: {
        code: "openFailed",
        path: filePath,
        cause: errorMessage(cause),
      },
    };
  }

  const db = drizzle(sqlite);

  return {
    ok: true,
    value: {
      filePath,
      sqlite,
      db,
      close(): void {
        closeSqlite(sqlite);
      },
    },
  };
}

/**
 * Returns the process-wide connection, opening it on the first call.
 *
 * Configuration is read from `source` only when no connection is open yet.
 * Later calls reuse the same connection so the application stays on one
 * process and one file. A production Next.js build is rejected before the
 * file is touched.
 */
export function getSqliteConnection(
  source: EnvSource = process.env,
): DatabaseResult<SqliteConnection> {
  if (activeConnection) {
    return { ok: true, value: activeConnection };
  }

  if (source.NEXT_PHASE === NEXT_PRODUCTION_BUILD_PHASE) {
    return { ok: false, error: { code: "buildTimeAccess" } };
  }

  const config = loadAppConfig(source);

  if (!config.ok) {
    return {
      ok: false,
      error: { code: "invalidConfig", configErrors: config.errors },
    };
  }

  const opened = openSqliteConnection(config.value);

  if (!opened.ok) {
    return opened;
  }

  activeConnection = opened.value;
  return opened;
}

/**
 * Closes the process-wide connection if it is open.
 *
 * Safe to call when nothing was opened, when the connection was already
 * closed, or after a failed open.
 */
export function closeSqliteConnection(): void {
  const connection = activeConnection;
  activeConnection = undefined;

  if (!connection) {
    return;
  }

  connection.close();
}

function applyConnectionPragmas(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
}

function closeSqlite(sqlite: Database.Database): void {
  if (!sqlite.open) {
    return;
  }

  sqlite.close();
}

function isExistingDirectory(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isDirectory();
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
