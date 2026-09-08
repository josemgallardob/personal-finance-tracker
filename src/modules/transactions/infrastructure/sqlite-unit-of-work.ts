/**
 * SQLite unit of work of the transaction adapters.
 *
 * The adapter runs on whatever Drizzle handle the caller owns: the connection
 * itself when a single statement is enough, or an open transaction when the
 * movement and its associations must land together. Both handles expose the
 * same query builder, so a repository never asks which one it received and
 * never opens a transaction of its own.
 *
 * The shape matches the classification unit on purpose. One runtime unit
 * therefore satisfies both ports, and a save that resolves tags and writes a
 * movement runs every statement inside the same SQL transaction.
 */

import "server-only";

import type Database from "better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import type { SqliteConnection } from "../../../shared/server/database";
import {
  type TransactionResult,
  failed,
} from "../application/ports/transaction-repository";
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
 * Use it for a single read or a single write. An operation that writes several
 * rows refuses this unit, because it could not undo a partial result.
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
 * rolled back too and reported as a controlled storage failure.
 */
export function runInTransaction<TValue>(
  connection: SqliteConnection,
  work: (unit: SqliteUnitOfWork) => TransactionResult<TValue>,
): TransactionResult<TValue> {
  let refusal: TransactionResult<TValue> | undefined;

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
