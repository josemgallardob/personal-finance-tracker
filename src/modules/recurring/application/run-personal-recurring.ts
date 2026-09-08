/**
 * Catch-up of personal monthly due dates for process startup and the command.
 *
 * The summary never carries amounts, concepts, paths or driver text. Callers
 * log the JSON line this module builds and decide the process exit from `ok`.
 */

import { type Clock, SystemClock } from "../../../shared/domain/clock";
import type { SqliteConnection } from "../../../shared/server/database";
import { createGenerateDueOccurrences } from "./generate-due-occurrences";
import { sqliteRecurringOccurrenceRepository } from "../infrastructure/sqlite-recurring-occurrence-repository";
import { sqliteRecurringRuleRepository } from "../infrastructure/sqlite-recurring-rule-repository";
import { sqliteDueDateRunner } from "../infrastructure/sqlite-unit-of-work";
import { sqliteTransactionRepository } from "../../transactions/infrastructure/sqlite-transaction-repository";
import { resolvePersonalWorkspace } from "../../preferences/server/workspace";

/** Closed set of reasons a catch-up did not run or did not finish cleanly. */
export type RecurringCatchUpCode =
  | "buildTimeAccess"
  | "invalidConfig"
  | "invalidPath"
  | "openFailed"
  | "workspaceNotFound"
  | "storageFailure"
  | "generationFailed";

/** Counts a scheduled run may record, with no personal financial data. */
export interface RecurringCatchUpSummary {
  readonly ok: boolean;
  readonly generated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly code?: RecurringCatchUpCode;
}

/** Builds the single JSON log line a process is allowed to print. */
export function formatRecurringCatchUpLog(
  summary: RecurringCatchUpSummary,
): string {
  return JSON.stringify({ event: "recurring_run", ...summary });
}

/**
 * Materialises overdue personal dates on an already open connection.
 *
 * The caller owns the file. This function never logs, never opens SQLite and
 * never reads the environment, so tests drive it against a temporary database.
 */
export function catchUpPersonalRecurring(
  connection: SqliteConnection,
  options: {
    readonly clock?: Clock;
    readonly now?: () => number;
    readonly createId?: () => string;
  } = {},
): RecurringCatchUpSummary {
  const workspace = resolvePersonalWorkspace(connection);

  if (!workspace.ok) {
    return {
      ok: false,
      generated: 0,
      skipped: 0,
      failed: 0,
      code: "workspaceNotFound",
    };
  }

  const generated = createGenerateDueOccurrences({
    runner: sqliteDueDateRunner(connection),
    rules: sqliteRecurringRuleRepository,
    occurrences: sqliteRecurringOccurrenceRepository,
    transactions: sqliteTransactionRepository,
    clock: options.clock ?? new SystemClock(),
    now: options.now,
    createId: options.createId,
  }).execute({ workspaceId: workspace.value.id });

  if (!generated.ok) {
    return {
      ok: false,
      generated: 0,
      skipped: 0,
      failed: 0,
      code: "storageFailure",
    };
  }

  const failed = generated.value.failed.length;

  return {
    ok: failed === 0,
    generated: generated.value.generated.length,
    skipped: generated.value.skipped.length,
    failed,
    ...(failed === 0 ? {} : { code: "generationFailed" as const }),
  };
}
