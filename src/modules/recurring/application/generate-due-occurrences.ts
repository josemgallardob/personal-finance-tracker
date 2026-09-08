/**
 * Materialisation of the due dates of the active rules.
 *
 * The task walks the active rules whose next date is not after today in Madrid
 * and materialises every date they owe, oldest first, so a server that was off
 * for three months recovers the three omitted dates in order. Each date is one
 * SQL transaction of its own: it re-reads the rule for writing, checks that it
 * is still active and still owes exactly that date, reserves the date, copies
 * the stored template into a movement with its tags and advances the rule, all
 * of it or none of it.
 *
 * Two properties come from that shape. A date is materialised exactly once,
 * because the reservation is decided by the unique index on rule and scheduled
 * day: a second run, a retry, a concurrent writer and the tombstone left by a
 * deleted generated movement are all refused there. And a failure is
 * recoverable: the failing date rolls back completely, the dates already
 * committed stay, the run continues with the other rules and the next run
 * resumes where this one stopped.
 *
 * The template is copied as it is stored. This use case deliberately does not
 * apply the validations of a manual save: a due date is a past civil date, and
 * the classification of a stored template is the one the rule was accepted
 * with, so refusing it here would suspend a monthly payment instead of
 * recording it.
 */

import { randomUUID } from "node:crypto";

import type {
  TransactionRepository,
  TransactionRepositoryErrorCode,
} from "../../transactions/application/ports/transaction-repository";
import {
  type Transaction,
  type TransactionId,
  createTransaction,
} from "../../transactions/domain/transaction";
import { type Clock, SystemClock } from "../../../shared/domain/clock";
import {
  type LocalDate,
  compareLocalDates,
} from "../../../shared/domain/dates";
import { toTimestamp } from "../../../shared/domain/timestamp";
import { nextDueDateAfter } from "../domain/recurrence-calendar";
import { createRecurringOccurrence } from "../domain/recurring-occurrence";
import {
  type RecurringRule,
  type RecurringRuleId,
  isActiveRecurringRule,
} from "../domain/recurring-rule";
import type { DueDateRunner } from "./ports/due-date-runner";
import {
  type RecurringOccurrenceRepository,
  type RecurringRepositoryErrorCode,
  type RecurringResult,
  type RecurringRuleRepository,
  type StoredRecurringRule,
  failed,
  succeeded,
} from "./ports/recurring-repository";
import type { UnitOfWork } from "./ports/unit-of-work";

/** Workspace whose rules the run materialises. */
export interface GenerateDueOccurrencesCommand {
  readonly workspaceId: string;
}

/** Due date the run materialised, with the movement it created. */
export interface GeneratedDueDate {
  readonly ruleId: RecurringRuleId;
  readonly scheduledFor: LocalDate;
  readonly transactionId: TransactionId;
}

/** Reason a due date was passed over without creating a movement. */
export type SkippedDueDateReason =
  /** An earlier run, another writer or a deleted entry already took it. */
  | "alreadyProcessed"
  /** The rule stopped, disappeared or moved on before the write. */
  | "ruleChanged";

/** Due date the run advanced past without creating a movement. */
export interface SkippedDueDate {
  readonly ruleId: RecurringRuleId;
  readonly scheduledFor: LocalDate;
  readonly reason: SkippedDueDateReason;
}

/** Due date the run could not materialise, with the rule it belongs to. */
export interface FailedDueDate {
  readonly ruleId: RecurringRuleId;
  readonly scheduledFor: LocalDate;
  readonly code: RecurringRepositoryErrorCode;
}

/**
 * Outcome of one run.
 *
 * A run reports what it did rather than throwing on the first problem: the
 * caller of a scheduled task needs to know that eleven dates landed and one
 * rule is stuck, not only that something went wrong.
 */
export interface GenerationReport {
  readonly generated: readonly GeneratedDueDate[];
  readonly skipped: readonly SkippedDueDate[];
  readonly failed: readonly FailedDueDate[];
}

/** Collaborators of the use case. Time and identifiers are injectable. */
export interface GenerateDueOccurrencesDeps<TUnit extends UnitOfWork> {
  readonly runner: DueDateRunner<TUnit>;
  readonly rules: RecurringRuleRepository<TUnit>;
  readonly occurrences: RecurringOccurrenceRepository<TUnit>;
  readonly transactions: TransactionRepository<TUnit>;
  readonly clock?: Clock;
  readonly createId?: () => string;
  readonly now?: () => number;
}

/** Generation task bound to one set of ports. */
export interface GenerateDueOccurrences {
  execute(
    command: GenerateDueOccurrencesCommand,
  ): RecurringResult<GenerationReport>;
}

/**
 * Builds the task.
 *
 * The current day, the current instant and the identifiers are injectable, so
 * a test can place the clock on any day and reproduce a race without patching
 * a calendar rule or a uniqueness rule.
 */
export function createGenerateDueOccurrences<TUnit extends UnitOfWork>(
  deps: GenerateDueOccurrencesDeps<TUnit>,
): GenerateDueOccurrences {
  const clock = deps.clock ?? new SystemClock();
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? Date.now;

  return {
    execute(command) {
      return runGeneration(command, deps, clock, createId, now);
    },
  };
}

/** Reservation and copy of one due date, before the rule is advanced. */
type ReservedDueDate =
  | { readonly kind: "generated"; readonly transactionId: TransactionId }
  | { readonly kind: "skipped"; readonly reason: "alreadyProcessed" };
type DueDateOutcome =
  | {
      readonly kind: "generated";
      readonly transactionId: TransactionId;
      readonly nextDueDate: LocalDate;
    }
  | {
      readonly kind: "skipped";
      readonly reason: "alreadyProcessed";
      readonly nextDueDate: LocalDate;
    }
  | { readonly kind: "skipped"; readonly reason: "ruleChanged" };

function runGeneration<TUnit extends UnitOfWork>(
  command: GenerateDueOccurrencesCommand,
  deps: GenerateDueOccurrencesDeps<TUnit>,
  clock: Clock,
  createId: () => string,
  now: () => number,
): RecurringResult<GenerationReport> {
  const today = clock.today();
  const due = deps.runner.runForDueDate((unit) =>
    deps.rules.findDueRules(unit, {
      workspaceId: command.workspaceId,
      onOrBefore: today,
    }),
  );

  if (!due.ok) {
    return due;
  }

  const generated: GeneratedDueDate[] = [];
  const skipped: SkippedDueDate[] = [];
  const failures: FailedDueDate[] = [];

  for (const stored of due.value) {
    collectRule(
      stored,
      command.workspaceId,
      today,
      deps,
      createId,
      now,
      generated,
      skipped,
      failures,
    );
  }

  return succeeded({ generated, skipped, failed: failures });
}

/**
 * Materialises every date one rule owes, stopping at its first failure.
 *
 * The dates of a rule are ordered, so a date that could not be written, or a
 * rule that changed under the writer, stops that rule and leaves the rest for
 * the next run. An already processed date still moves the cursor forward, so a
 * crashed run can resume. The other rules of the workspace keep going.
 */
function collectRule<TUnit extends UnitOfWork>(
  stored: StoredRecurringRule,
  workspaceId: string,
  today: LocalDate,
  deps: GenerateDueOccurrencesDeps<TUnit>,
  createId: () => string,
  now: () => number,
  generated: GeneratedDueDate[],
  skipped: SkippedDueDate[],
  failures: FailedDueDate[],
): void {
  const ruleId = stored.rule.id;
  let scheduledFor = stored.rule.nextDueDate;

  while (compareLocalDates(scheduledFor, today) <= 0) {
    const outcome = deps.runner.runForDueDate((unit) =>
      materialiseDueDate(unit, {
        workspaceId,
        ruleId,
        scheduledFor,
        deps,
        createId,
        now,
      }),
    );

    if (!outcome.ok) {
      failures.push({ ruleId, scheduledFor, code: outcome.error.code });
      return;
    }

    if (outcome.value.kind === "generated") {
      generated.push({
        ruleId,
        scheduledFor,
        transactionId: outcome.value.transactionId,
      });
      scheduledFor = outcome.value.nextDueDate;
      continue;
    }

    skipped.push({ ruleId, scheduledFor, reason: outcome.value.reason });

    if (outcome.value.reason === "ruleChanged") {
      return;
    }

    scheduledFor = outcome.value.nextDueDate;
  }
}

/**
 * Materialises every date one rule still owes, inside a transaction the caller
 * already owns.
 *
 * Edit and deactivation use this instead of the scheduled runner: the overdue
 * dates and the template change must land together, so a concurrent generation
 * cannot slip between catch-up and the change. Dates another run already
 * reserved are skipped and the cursor still moves, which is what makes a retry
 * after a rolled-back edit idempotent.
 */
export function catchUpDueDatesInUnit<TUnit extends UnitOfWork>(
  unit: TUnit,
  work: {
    readonly workspaceId: string;
    readonly ruleId: RecurringRuleId;
    readonly today: LocalDate;
    readonly deps: Pick<
      GenerateDueOccurrencesDeps<TUnit>,
      "rules" | "occurrences" | "transactions"
    >;
    readonly createId: () => string;
    readonly now: () => number;
  },
): RecurringResult<readonly GeneratedDueDate[]> {
  const stored = work.deps.rules.findRuleForUpdate(unit, {
    workspaceId: work.workspaceId,
    ruleId: work.ruleId,
  });

  if (!stored.ok) {
    return stored;
  }

  if (stored.value === null || !isActiveRecurringRule(stored.value.rule)) {
    return failed("ruleNotFound");
  }

  const generated: GeneratedDueDate[] = [];
  let scheduledFor = stored.value.rule.nextDueDate;

  while (compareLocalDates(scheduledFor, work.today) <= 0) {
    const outcome = materialiseDueDate(unit, {
      workspaceId: work.workspaceId,
      ruleId: work.ruleId,
      scheduledFor,
      deps: work.deps,
      createId: work.createId,
      now: work.now,
    });

    if (!outcome.ok) {
      return outcome;
    }

    if (outcome.value.kind === "generated") {
      generated.push({
        ruleId: work.ruleId,
        scheduledFor,
        transactionId: outcome.value.transactionId,
      });
      scheduledFor = outcome.value.nextDueDate;
      continue;
    }

    if (outcome.value.reason === "ruleChanged") {
      return failed("staleNextDueDate");
    }

    scheduledFor = outcome.value.nextDueDate;
  }

  return succeeded(generated);
}

interface DueDateWork<TUnit extends UnitOfWork> {
  readonly workspaceId: string;
  readonly ruleId: RecurringRuleId;
  readonly scheduledFor: LocalDate;
  readonly deps: Pick<
    GenerateDueOccurrencesDeps<TUnit>,
    "rules" | "occurrences" | "transactions"
  >;
  readonly createId: () => string;
  readonly now: () => number;
}

/**
 * Writes one due date inside the transaction the runner opened.
 *
 * Everything this function decides is decided from rows it read inside that
 * same transaction, so a rule that stopped or moved on between the listing and
 * the write is detected here rather than acted upon.
 */
function materialiseDueDate<TUnit extends UnitOfWork>(
  unit: TUnit,
  work: DueDateWork<TUnit>,
): RecurringResult<DueDateOutcome> {
  if (!unit.isTransactional) {
    return failed("transactionRequired");
  }

  const stored = work.deps.rules.findRuleForUpdate(unit, {
    workspaceId: work.workspaceId,
    ruleId: work.ruleId,
  });

  if (!stored.ok) {
    return stored;
  }

  if (stored.value === null || !owesExactly(stored.value.rule, work)) {
    return succeeded({ kind: "skipped", reason: "ruleChanged" });
  }

  const following = nextDueDateAfter(
    work.scheduledFor,
    stored.value.rule.monthlyDay,
  );

  if (!following.ok) {
    return failed("invalidStoredRow", following.error);
  }

  const writtenAt = toTimestamp("createdAt", work.now());

  if (!writtenAt.ok) {
    return failed("storageFailure", "the clock reported an unusable instant");
  }

  const materialised = reserveAndCopy(
    unit,
    work,
    stored.value,
    writtenAt.value,
  );

  if (!materialised.ok) {
    return materialised;
  }

  const advanced = work.deps.rules.advanceNextDueDate(unit, {
    workspaceId: work.workspaceId,
    ruleId: work.ruleId,
    from: work.scheduledFor,
    to: following.value,
    updatedAt: writtenAt.value,
  });

  if (!advanced.ok) {
    if (
      materialised.value.kind === "skipped" &&
      materialised.value.reason === "alreadyProcessed" &&
      advanced.error.code === "staleNextDueDate"
    ) {
      return succeeded({
        kind: "skipped",
        reason: "alreadyProcessed",
        nextDueDate: following.value,
      });
    }

    return advanced;
  }

  if (materialised.value.kind === "generated") {
    return succeeded({
      kind: "generated",
      transactionId: materialised.value.transactionId,
      nextDueDate: following.value,
    });
  }

  return succeeded({
    kind: "skipped",
    reason: "alreadyProcessed",
    nextDueDate: following.value,
  });
}

/** Tells whether the stored rule still owes exactly the date being written. */
function owesExactly<TUnit extends UnitOfWork>(
  rule: RecurringRule,
  work: DueDateWork<TUnit>,
): boolean {
  return isActiveRecurringRule(rule) && rule.nextDueDate === work.scheduledFor;
}

/**
 * Reserves the date and copies the template into a movement.
 *
 * A date that is already reserved is not an error: an earlier run created it,
 * a concurrent run is creating it, or the user deleted the movement it created
 * and the reservation stayed behind as the proof that the date was processed.
 * In every case no second movement is written and the rule still moves on, so
 * the date is never revisited.
 */
function reserveAndCopy<TUnit extends UnitOfWork>(
  unit: TUnit,
  work: DueDateWork<TUnit>,
  stored: StoredRecurringRule,
  writtenAt: number,
): RecurringResult<ReservedDueDate> {
  const occurrence = createRecurringOccurrence({
    id: work.createId(),
    recurringRuleId: work.ruleId,
    scheduledFor: work.scheduledFor,
    transactionId: null,
    createdAt: writtenAt,
  });

  if (!occurrence.ok) {
    return failed("invalidStoredRow", describeDomainErrors(occurrence.errors));
  }

  const reserved = work.deps.occurrences.reserveOccurrence(unit, {
    workspaceId: work.workspaceId,
    occurrence: occurrence.value,
  });

  if (!reserved.ok) {
    if (reserved.error.code !== "alreadyProcessed") {
      return reserved;
    }

    return succeeded({ kind: "skipped", reason: "alreadyProcessed" });
  }

  const copied = copyTemplate(work, stored, writtenAt);

  if (!copied.ok) {
    return copied;
  }

  const inserted = work.deps.transactions.insertTransaction(unit, {
    workspaceId: work.workspaceId,
    transaction: copied.value,
  });

  if (!inserted.ok) {
    return failed(toRecurringCode(inserted.error.code), inserted.error.cause);
  }

  const linked = work.deps.occurrences.linkGeneratedTransaction(unit, {
    workspaceId: work.workspaceId,
    occurrenceId: reserved.value.id,
    transactionId: copied.value.id,
  });

  if (!linked.ok) {
    return linked;
  }

  return succeeded({ kind: "generated", transactionId: copied.value.id });
}

/**
 * Builds the movement of a due date from the stored template.
 *
 * The civil date of the movement is the scheduled day, not the day the task
 * happened to run, so a recovered month lands on the date it was owed for.
 */
function copyTemplate<TUnit extends UnitOfWork>(
  work: DueDateWork<TUnit>,
  stored: StoredRecurringRule,
  writtenAt: number,
): RecurringResult<Transaction> {
  const built = createTransaction({
    id: work.createId(),
    type: stored.rule.template.type,
    amountMinor: stored.rule.template.amountMinor,
    date: work.scheduledFor,
    category: stored.category,
    concept: stored.rule.template.concept,
    note: stored.rule.template.note,
    tagIds: stored.rule.template.tagIds,
    createdAt: writtenAt,
    updatedAt: writtenAt,
  });

  if (!built.ok) {
    return failed("invalidStoredRow", describeDomainErrors(built.errors));
  }

  return succeeded(built.value);
}

/** Maps a refusal of the movement port onto the vocabulary of this module. */
function toRecurringCode(
  code: TransactionRepositoryErrorCode,
): RecurringRepositoryErrorCode {
  switch (code) {
    case "duplicateId":
      return "duplicateId";
    case "unknownCategory":
      return "unknownCategory";
    case "unknownTag":
      return "unknownTag";
    case "unknownWorkspace":
      return "unknownWorkspace";
    case "transactionNotFound":
      return "unknownTransaction";
    case "transactionRequired":
      return "transactionRequired";
    case "invalidStoredRow":
      return "invalidStoredRow";
    case "storageFailure":
      return "storageFailure";
  }
}

/** Technical detail kept for logs. It never carries personal data. */
function describeDomainErrors(
  errors: readonly { readonly field: string; readonly code: string }[],
): string {
  return errors.map((error) => `${error.field}:${error.code}`).join(",");
}
