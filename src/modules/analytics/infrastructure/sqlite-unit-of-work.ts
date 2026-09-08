/**
 * SQLite unit of work of the analytics adapters.
 *
 * The adapters run on whatever Drizzle handle the caller owns: the connection
 * itself when a single aggregation is enough, or an open transaction when the
 * whole dashboard must observe the same data. Both handles expose the same
 * query builder, so a repository never asks which one it received.
 *
 * The shape matches the transaction and classification units on purpose. One
 * runtime unit therefore satisfies every port, and a request that reads the
 * dashboard and a page of the history sees a single state of the database.
 */

import "server-only";

import type Database from "better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import type { SqliteConnection } from "../../../shared/server/database";
import {
  type AnalyticsResult,
  failed,
} from "../application/ports/analytics-repository";
import type { AnalyticsSnapshotRunner } from "../application/ports/analytics-snapshot";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { describeCause } from "./sqlite-errors";

/** Drizzle handle a connection and an open transaction have in common. */
export type SqliteQueryRunner = BaseSQLiteDatabase<"sync", Database.RunResult>;

/** Unit of work backed by a real SQLite handle. */
export interface SqliteUnitOfWork extends UnitOfWork {
  readonly db: SqliteQueryRunner;
}

/**
 * Wraps an open connection as a unit that runs each statement on its own.
 *
 * Use it for a single aggregation. Several reads that must agree with each
 * other need {@link runInReadSnapshot} instead.
 */
export function autocommitUnitOfWork(
  connection: SqliteConnection,
): SqliteUnitOfWork {
  return { isTransactional: false, db: connection.db };
}

/**
 * Runs `work` inside one SQL transaction, which is the read snapshot of the
 * dashboard.
 *
 * Every read of `work` observes the state the transaction started with, so a
 * movement written while the dashboard is being composed cannot appear in one
 * figure and be missing from another. Analytics only reads, so nothing is
 * rolled back for a refusal: the refusal is returned unchanged and an
 * unexpected throw is reported as a controlled storage failure.
 */
export function runInReadSnapshot<TValue>(
  connection: SqliteConnection,
  work: (unit: SqliteUnitOfWork) => AnalyticsResult<TValue>,
): AnalyticsResult<TValue> {
  try {
    return connection.db.transaction((tx) =>
      work({ isTransactional: true, db: tx }),
    );
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }
}

/** Snapshot runner the dashboard services use for one consistent response. */
export function sqliteAnalyticsSnapshotRunner(
  connection: SqliteConnection,
): AnalyticsSnapshotRunner<SqliteUnitOfWork> {
  return {
    runInSnapshot(work) {
      return runInReadSnapshot(connection, work);
    },
  };
}
