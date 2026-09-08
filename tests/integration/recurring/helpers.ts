/**
 * Real-file setup for the recurrence repository and generation tests.
 *
 * The fixtures reuse the transaction ones: an isolated SQLite file with the
 * production PRAGMAs, the committed migrations and the personal workspace, and
 * categories, tags and movements written through the real adapters. Nothing
 * here stubs the driver, the constraints, the repositories or the use case; a
 * second connection to the same file is a real second writer, and the
 * identifier generators below only make identifiers predictable, never
 * uniqueness itself.
 */

import { randomUUID } from "node:crypto";

import { createGenerateDueOccurrences } from "../../../src/modules/recurring/application/generate-due-occurrences";
import type { DueDateRunner } from "../../../src/modules/recurring/application/ports/due-date-runner";
import type {
  RecurringRepositoryErrorCode,
  RecurringResult,
} from "../../../src/modules/recurring/application/ports/recurring-repository";
import {
  type RecurringRule,
  createRecurringRule,
} from "../../../src/modules/recurring/domain/recurring-rule";
import { sqliteRecurringOccurrenceRepository } from "../../../src/modules/recurring/infrastructure/sqlite-recurring-occurrence-repository";
import { sqliteRecurringRuleRepository } from "../../../src/modules/recurring/infrastructure/sqlite-recurring-rule-repository";
import {
  type SqliteUnitOfWork,
  runInTransaction,
  sqliteDueDateRunner,
} from "../../../src/modules/recurring/infrastructure/sqlite-unit-of-work";
import type { Category } from "../../../src/modules/classification/domain/category";
import { sqliteTransactionRepository } from "../../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate } from "../../../src/shared/domain/dates";
import { loadAppConfig } from "../../../src/shared/server/config";
import {
  openSqliteConnection,
  type SqliteConnection,
} from "../../../src/shared/server/database";
import { createValidAppEnv } from "../helpers/sqlite";
import type { TransactionFixture } from "../transactions/helpers";

export {
  createTransactionFixture as createRecurringFixture,
  newTransaction,
  storeCategory,
  storeTag,
  type TransactionFixture as RecurringFixture,
} from "../transactions/helpers";

/** Instant every fixture row is written with. */
export const NOW = 1_746_268_800_000;

/**
 * Opens another real connection to the file of the fixture.
 *
 * The caller closes it. Two connections to the same file are two real writers
 * with the production PRAGMAs, so a race between them is decided by SQLite and
 * by the constraints of the schema, not by the test.
 */
export function openWriter(fixture: TransactionFixture): SqliteConnection {
  const config = loadAppConfig(createValidAppEnv(fixture.connection.filePath));

  if (!config.ok) {
    throw new Error(`Expected valid configuration: ${JSON.stringify(config)}`);
  }

  const opened = openSqliteConnection(config.value);

  if (!opened.ok) {
    throw new Error(`Expected a second writer: ${JSON.stringify(opened)}`);
  }

  return opened.value;
}

/** Values a test rule is built from, with sensible defaults. */
export interface RecurringRuleDraft {
  readonly id?: string;
  readonly sourceTransactionId?: string | null;
  readonly category: Category;
  readonly amountMinor?: number;
  readonly concept?: string | null;
  readonly note?: string | null;
  readonly tagIds?: readonly string[];
  readonly monthlyDay?: number;
  readonly nextDueDate: string;
  readonly templateVersion?: number;
  readonly deactivatedAt?: number | null;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

/** Builds a rule through the domain contract that guards its fields. */
export function newRule(draft: RecurringRuleDraft): RecurringRule {
  const built = createRecurringRule({
    id: draft.id ?? randomUUID(),
    sourceTransactionId: draft.sourceTransactionId ?? null,
    type: draft.category.type,
    amountMinor: draft.amountMinor ?? 1_299,
    category: draft.category,
    concept: draft.concept ?? null,
    note: draft.note ?? null,
    tagIds: draft.tagIds ?? [],
    monthlyDay: draft.monthlyDay ?? 31,
    nextDueDate: draft.nextDueDate,
    templateVersion: draft.templateVersion ?? 1,
    deactivatedAt: draft.deactivatedAt ?? null,
    createdAt: draft.createdAt ?? NOW,
    updatedAt: draft.updatedAt ?? NOW,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid rule: ${JSON.stringify(built)}`);
  }

  return built.value;
}

/** Writes a rule and its template tags through the real adapter. */
export function storeRule(
  fixture: TransactionFixture,
  draft: RecurringRuleDraft,
): RecurringRule {
  const rule = newRule(draft);
  const stored = runInTransaction(fixture.connection, (unit) =>
    sqliteRecurringRuleRepository.insertRule(unit, {
      workspaceId: fixture.workspaceId,
      rule,
    }),
  );

  if (!stored.ok) {
    throw new Error(`Expected a stored rule: ${JSON.stringify(stored)}`);
  }

  return stored.value;
}

/** Options of a generation task bound to one connection. */
export interface GeneratorOptions {
  /** Civil day the task believes it runs on, in Madrid. */
  readonly today: string;
  readonly createId?: () => string;
  readonly now?: () => number;
  /** Replaces the real runner to interleave another writer between dates. */
  readonly runner?: DueDateRunner<SqliteUnitOfWork>;
}

/** Builds the generation task on the real adapters of a connection. */
export function createGenerator(
  connection: SqliteConnection,
  options: GeneratorOptions,
) {
  return createGenerateDueOccurrences<SqliteUnitOfWork>({
    runner: options.runner ?? sqliteDueDateRunner(connection),
    rules: sqliteRecurringRuleRepository,
    occurrences: sqliteRecurringOccurrenceRepository,
    transactions: sqliteTransactionRepository,
    clock: new FixedClock(options.today as LocalDate),
    createId: options.createId,
    now: options.now ?? (() => NOW),
  });
}

/** Predictable identifiers, so a test can name the row it is looking at. */
export function sequentialIds(prefix: string): () => string {
  let next = 0;

  return () => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
}

/** Movements of the file, ordered by civil date. */
export function readTransactions(connection: SqliteConnection) {
  return connection.sqlite
    .prepare(
      `SELECT id, type, amount_minor AS amountMinor, date,
              category_id AS categoryId, concept, note
       FROM "transaction" ORDER BY date, id`,
    )
    .all();
}

/** Tag associations of a movement, ordered by tag. */
export function readTransactionTags(
  connection: SqliteConnection,
  transactionId: string,
): string[] {
  return (
    connection.sqlite
      .prepare(
        `SELECT tag_id AS tagId FROM transaction_tag
         WHERE transaction_id = ? ORDER BY tag_id`,
      )
      .all(transactionId) as Array<{ tagId: string }>
  ).map((row) => row.tagId);
}

/** Processed due dates of the file, ordered by scheduled day. */
export function readOccurrences(connection: SqliteConnection) {
  return connection.sqlite
    .prepare(
      `SELECT id, recurring_rule_id AS recurringRuleId,
              scheduled_for AS scheduledFor, transaction_id AS transactionId
       FROM recurring_occurrence ORDER BY scheduled_for, id`,
    )
    .all();
}

/** Stored state of one rule. */
export function readRule(connection: SqliteConnection, ruleId: string) {
  return connection.sqlite
    .prepare(
      `SELECT next_due_date AS nextDueDate, deactivated_at AS deactivatedAt
       FROM recurring_rule WHERE id = ?`,
    )
    .get(ruleId);
}

/** Stops a rule with a real write, as the deactivation use case will. */
export function deactivateRule(
  connection: SqliteConnection,
  ruleId: string,
): void {
  connection.sqlite
    .prepare("UPDATE recurring_rule SET deactivated_at = ? WHERE id = ?")
    .run(NOW, ruleId);
}

/** Rewinds the next date of a rule, as a crashed run would have left it. */
export function rewindNextDueDate(
  connection: SqliteConnection,
  ruleId: string,
  nextDueDate: string,
): void {
  connection.sqlite
    .prepare("UPDATE recurring_rule SET next_due_date = ? WHERE id = ?")
    .run(nextDueDate, ruleId);
}

/** Value of an accepted outcome; fails loudly when it was refused. */
export function okValue<TValue>(result: RecurringResult<TValue>): TValue {
  if (!result.ok) {
    throw new Error(`Expected success: ${JSON.stringify(result.error)}`);
  }

  return result.value;
}

/** Refusal code of an outcome, or `"ok"` when it unexpectedly succeeded. */
export function errorCode(
  result: RecurringResult<unknown>,
): RecurringRepositoryErrorCode | "ok" {
  return result.ok ? "ok" : result.error.code;
}
