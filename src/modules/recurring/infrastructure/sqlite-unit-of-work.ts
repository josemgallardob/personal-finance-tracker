/**
 * SQLite unit of work of the recurrence adapters.
 *
 * The adapters run on whatever Drizzle handle the caller owns: the connection
 * itself for a single read, or an open transaction when a due date must land
 * completely or not at all. Both handles expose the same query builder, so a
 * repository never asks which one it received and never opens a transaction of
 * its own.
 *
 * The shape matches the transaction and classification units on purpose. One
 * runtime unit therefore satisfies every port, which is what lets the generator
 * reserve a due date and write the movement through its owning port inside a
 * single SQL transaction.
 */

import "server-only";

import type Database from "better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import type { SqliteConnection } from "../../../shared/server/database";
import type { DueDateRunner } from "../application/ports/due-date-runner";
import {
  type RecurringResult,
  failed,
} from "../application/ports/recurring-repository";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { describeCause } from "./sqlite-errors";

/** Drizzle handle a connection and an open transaction have in common. */
export type SqliteQueryRunner = BaseSQLiteDatabase<"sync", Database.RunResult>;

/** Unit of work backed by a real SQLite handle. */
export interface SqliteUnitOfWork extends UnitOfWork {
  readonly db: SqliteQueryRunner;
}

/** Thrown to make SQLite roll back work that reported a business refusal. */
const ROLLBACK_SIGNAL = new Error("Transaction work was rolled back");

/**
 * Wraps an open connection as a unit that commits each statement on its own.
 *
 * Use it for a single read. Materialising a due date refuses this unit,
 * because it could not undo a reservation whose movement was never written.
 */
export function autocommitUnitOfWork(
  connection: SqliteConnection,
): SqliteUnitOfWork {
  return { isTransactional: false, db: connection.db };
}

/**
 * Runs `work` inside one SQL transaction the caller owns.
 *
 * The transaction commits only when the work reports success. A refusal rolls
 * every statement back and is returned unchanged, and an unexpected throw is
 * rolled back too and reported as a controlled storage failure. A writer that
 * lost a race against another connection therefore leaves nothing behind, and
 * the next run of the task finds a database it can resume from.
 */
export function runInTransaction<TValue>(
  connection: SqliteConnection,
  work: (unit: SqliteUnitOfWork) => RecurringResult<TValue>,
): RecurringResult<TValue> {
  let refusal: RecurringResult<TValue> | undefined;

  try {
    return connection.db.transaction((tx) => {
      const result = work({ isTransactional: true, db: tx });

      if (!result.ok) {
        refusal = result;
        throw ROLLBACK_SIGNAL;
      }

      return result;
    });
  } catch (cause) {
    if (refusal) {
      return refusal;
    }

    return failed("storageFailure", describeCause(cause));
  }
}

/** Due-date runner the generation task opens one transaction per date with. */
export function sqliteDueDateRunner(
  connection: SqliteConnection,
): DueDateRunner<SqliteUnitOfWork> {
  return {
    runForDueDate(work) {
      return runInTransaction(connection, work);
    },
  };
}
