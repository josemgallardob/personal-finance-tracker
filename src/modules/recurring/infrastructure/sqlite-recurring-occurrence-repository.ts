/**
 * SQLite adapter of the processed due date port.
 *
 * Reserving a date is an insertion, and the unique index on rule and scheduled
 * day is what decides whether it is the first one. The adapter therefore
 * attempts the write and reads the verdict from the driver instead of looking
 * for the row first: between a lookup and an insertion another connection
 * could slip in, while between the statement and its constraint nothing can.
 *
 * Linking the movement is a separate statement on purpose. The reservation
 * exists before the movement does, so a run that fails halfway leaves the whole
 * transaction rolled back rather than a movement nobody reserved.
 */

import "server-only";

import { and, eq } from "drizzle-orm";

import { recurringOccurrence, workspace } from "../../../../db/schema";
import {
  type ClearGeneratedTransactionCommand,
  type LinkGeneratedTransactionCommand,
  type RecurringOccurrenceRepository,
  type RecurringResult,
  type ReserveOccurrenceCommand,
  failed,
  succeeded,
} from "../application/ports/recurring-repository";
import {
  type RecurringOccurrence,
  createRecurringOccurrence,
} from "../domain/recurring-occurrence";
import {
  describeCause,
  isForeignKeyViolation,
  isUniqueViolation,
} from "./sqlite-errors";
import type { SqliteUnitOfWork } from "./sqlite-unit-of-work";

/** Processed due date, as stored. */
interface OccurrenceRow {
  readonly id: string;
  readonly recurringRuleId: string;
  readonly scheduledFor: string;
  readonly transactionId: string | null;
  readonly createdAt: number;
}

const SELECTED_COLUMNS = {
  id: recurringOccurrence.id,
  recurringRuleId: recurringOccurrence.recurringRuleId,
  scheduledFor: recurringOccurrence.scheduledFor,
  transactionId: recurringOccurrence.transactionId,
  createdAt: recurringOccurrence.createdAt,
};

/**
 * Reserves one due date of one rule.
 *
 * A unique violation is not an unexpected failure here: it is the answer that
 * the date was already processed, whether by an earlier run, by a concurrent
 * one, or by a run whose movement the user has since deleted.
 */
function reserveOccurrence(
  unit: SqliteUnitOfWork,
  command: ReserveOccurrenceCommand,
): RecurringResult<RecurringOccurrence> {
  const stored = command.occurrence;
  let inserted: OccurrenceRow[];

  try {
    inserted = unit.db
      .insert(recurringOccurrence)
      .values({
        id: stored.id,
        workspaceId: command.workspaceId,
        recurringRuleId: stored.recurringRuleId,
        scheduledFor: stored.scheduledFor,
        transactionId: stored.transactionId,
        createdAt: stored.createdAt,
      })
      .returning(SELECTED_COLUMNS)
      .all();
  } catch (cause) {
    if (isUniqueViolation(cause)) {
      return failed("alreadyProcessed", describeCause(cause));
    }

    if (isForeignKeyViolation(cause)) {
      return occurrenceForeignKeyFailure(unit, command.workspaceId, cause);
    }

    return failed("storageFailure", describeCause(cause));
  }

  const [row] = inserted;

  if (!row) {
    return failed("storageFailure", "the reservation returned no row");
  }

  return toOccurrence(row);
}

function linkGeneratedTransaction(
  unit: SqliteUnitOfWork,
  command: LinkGeneratedTransactionCommand,
): RecurringResult<RecurringOccurrence> {
  let updated: OccurrenceRow[];

  try {
    updated = unit.db
      .update(recurringOccurrence)
      .set({ transactionId: command.transactionId })
      .where(
        and(
          eq(recurringOccurrence.workspaceId, command.workspaceId),
          eq(recurringOccurrence.id, command.occurrenceId),
        ),
      )
      .returning(SELECTED_COLUMNS)
      .all();
  } catch (cause) {
    if (isUniqueViolation(cause)) {
      return failed("alreadyProcessed", describeCause(cause));
    }

    if (isForeignKeyViolation(cause)) {
      return failed("unknownTransaction", describeCause(cause));
    }

    return failed("storageFailure", describeCause(cause));
  }

  const [row] = updated;

  if (!row) {
    return failed("occurrenceNotFound");
  }

  return toOccurrence(row);
}

function clearGeneratedTransaction(
  unit: SqliteUnitOfWork,
  command: ClearGeneratedTransactionCommand,
): RecurringResult<RecurringOccurrence | null> {
  let updated: OccurrenceRow[];

  try {
    updated = unit.db
      .update(recurringOccurrence)
      .set({ transactionId: null })
      .where(
        and(
          eq(recurringOccurrence.workspaceId, command.workspaceId),
          eq(recurringOccurrence.transactionId, command.transactionId),
        ),
      )
      .returning(SELECTED_COLUMNS)
      .all();
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }

  const [row] = updated;

  if (!row) {
    return succeeded(null);
  }

  return toOccurrence(row);
}

function occurrenceForeignKeyFailure(
  unit: SqliteUnitOfWork,
  workspaceId: string,
  cause: unknown,
): RecurringResult<RecurringOccurrence> {
  let workspaces: { readonly id: string }[];

  try {
    workspaces = unit.db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .all();
  } catch (lookupCause) {
    return failed("storageFailure", describeCause(lookupCause));
  }

  if (workspaces.length === 0) {
    return failed("unknownWorkspace", describeCause(cause));
  }

  return failed("ruleNotFound", describeCause(cause));
}

/** Rebuilds a stored row through the domain contract. */
function toOccurrence(
  row: OccurrenceRow,
): RecurringResult<RecurringOccurrence> {
  const built = createRecurringOccurrence({
    id: row.id,
    recurringRuleId: row.recurringRuleId,
    scheduledFor: row.scheduledFor,
    transactionId: row.transactionId,
    createdAt: row.createdAt,
  });

  if (!built.ok) {
    return failed(
      "invalidStoredRow",
      built.errors.map((error) => `${error.field}:${error.code}`).join(","),
    );
  }

  return succeeded(built.value);
}

/** Processed due date port backed by a real SQLite file. */
export const sqliteRecurringOccurrenceRepository: RecurringOccurrenceRepository<SqliteUnitOfWork> =
  {
    reserveOccurrence,
    linkGeneratedTransaction,
    clearGeneratedTransaction,
  };
