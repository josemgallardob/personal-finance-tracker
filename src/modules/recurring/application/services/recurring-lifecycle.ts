/**
 * Activation, listing, preview, edit and irreversible deactivation of rules.
 *
 * Marking a movement, or creating a movement together with its rule, happens
 * inside the caller-owned SQL transaction so a refused rule never leaves a
 * movement behind. Edit and deactivation catch up overdue dates with the old
 * template in that same transaction, then apply the change; a failure rolls
 * every statement back and a retry does not duplicate a date.
 *
 * Copying a movement is a separate create without a rule, so it never inherits
 * recurrence. Editing a generated entry is a movement update and does not
 * touch the template.
 */

import { randomUUID } from "node:crypto";

import {
  type ResolveTagInput,
  resolveTags,
} from "../../../classification/application/resolve-tags";
import { createClassificationMaintenance } from "../../../classification/application/services/classification-maintenance";
import type { CategoryRepository } from "../../../classification/application/ports/category-repository";
import type { TagRepository } from "../../../classification/application/ports/tag-repository";
import { type Clock, SystemClock } from "../../../../shared/domain/clock";
import type { LocalDate } from "../../../../shared/domain/dates";
import { parseLocalDate } from "../../../../shared/domain/dates";
import {
  type DomainError,
  type DomainResult,
  domainError,
  invalid,
  valid,
} from "../../../../shared/domain/errors";
import { isIdentifier } from "../../../../shared/domain/text";
import { toTimestamp } from "../../../../shared/domain/timestamp";
import {
  type CreateTransaction,
  type CreateTransactionCommand,
  createCreateTransaction,
} from "../../../transactions/application/create-transaction";
import type {
  TransactionRepository,
  TransactionRepositoryErrorCode,
} from "../../../transactions/application/ports/transaction-repository";
import type {
  Transaction,
  TransactionId,
} from "../../../transactions/domain/transaction";
import {
  type MonthlyDay,
  isMonthlyDay,
  nextDueDateAfter,
  resolveDueSchedule,
} from "../../domain/recurrence-calendar";
import {
  type RecurringRule,
  type RecurringRuleId,
  createRecurringRule,
  deactivateRecurringRule,
  editRecurringRule,
  isActiveRecurringRule,
  INITIAL_TEMPLATE_VERSION,
} from "../../domain/recurring-rule";
import {
  type GeneratedDueDate,
  catchUpDueDatesInUnit,
} from "../generate-due-occurrences";
import type {
  RecurringOccurrenceRepository,
  RecurringRepositoryError,
  RecurringResult,
  RecurringRuleRepository,
  StoredRecurringRule,
} from "../ports/recurring-repository";
import type { UnitOfWork } from "../ports/unit-of-work";

/** Collaborators of the lifecycle services. */
export interface RecurringLifecycleDeps<TUnit extends UnitOfWork> {
  readonly rules: RecurringRuleRepository<TUnit>;
  readonly occurrences: RecurringOccurrenceRepository<TUnit>;
  readonly transactions: TransactionRepository<TUnit>;
  readonly categories: CategoryRepository<TUnit>;
  readonly tags: TagRepository<TUnit>;
  readonly clock?: Clock;
  readonly createId?: () => string;
  readonly now?: () => number;
}

/** Preview of the first due date of a monthly day. */
export interface PreviewNextDueDateCommand {
  readonly monthlyDay: number;
  /** Civil day the first due date must be strictly after. Defaults to today. */
  readonly after?: string;
}

/** Read of the overdue dates a later edit or deactivation would materialise. */
export interface PreviewCatchUpCommand {
  readonly workspaceId: string;
  readonly ruleId: string;
}

/** Workspace-scoped list of the active templates. */
export interface ListActiveRulesCommand {
  readonly workspaceId: string;
}

/** Activation of an existing movement as a monthly template. */
export interface ActivateFromTransactionCommand {
  readonly workspaceId: string;
  readonly transactionId: string;
  readonly monthlyDay: number;
}

/** Atomic create of a movement and of the rule that copies it. */
export interface ActivateWithNewTransactionCommand extends CreateTransactionCommand {
  readonly monthlyDay: number;
}

/** Replacement of an active template after catching up overdue dates. */
export interface EditRecurringRuleCommand {
  readonly workspaceId: string;
  readonly ruleId: string;
  readonly templateVersion: number;
  readonly monthlyDay: number;
  readonly type: string;
  readonly amountMinor: number;
  readonly categoryId: string;
  readonly concept: string | null;
  readonly note: string | null;
  readonly tags?: readonly ResolveTagInput[];
}

/** Irreversible stop of an active rule after catching up overdue dates. */
export interface DeactivateRecurringRuleCommand {
  readonly workspaceId: string;
  readonly ruleId: string;
  readonly templateVersion: number;
}

/** Active templates grouped the way the Recurrentes tab presents them. */
export interface ActiveRulesList {
  readonly expenses: readonly StoredRecurringRule[];
  readonly incomes: readonly StoredRecurringRule[];
}

/** Overdue dates that would be created with the current template. */
export interface CatchUpPreview {
  readonly pending: readonly LocalDate[];
  readonly rule: RecurringRule;
}

/** Result of an activation that also created the origin movement. */
export interface ActivatedWithTransaction {
  readonly transaction: Transaction;
  readonly rule: RecurringRule;
}

/** Result of an edit or deactivation that may have recovered overdue dates. */
export interface RecurringRuleChange {
  readonly rule: RecurringRule;
  readonly generated: readonly GeneratedDueDate[];
}

/** Lifecycle services bound to one set of ports. */
export interface RecurringLifecycle<TUnit extends UnitOfWork> {
  previewNextDueDate(
    command: PreviewNextDueDateCommand,
  ): DomainResult<{ readonly nextDueDate: LocalDate }>;
  previewCatchUp(
    unit: TUnit,
    command: PreviewCatchUpCommand,
  ): DomainResult<CatchUpPreview>;
  listActiveRules(
    unit: TUnit,
    command: ListActiveRulesCommand,
  ): DomainResult<ActiveRulesList>;
  activateFromTransaction(
    unit: TUnit,
    command: ActivateFromTransactionCommand,
  ): DomainResult<RecurringRule>;
  activateWithNewTransaction(
    unit: TUnit,
    command: ActivateWithNewTransactionCommand,
  ): DomainResult<ActivatedWithTransaction>;
  editRule(
    unit: TUnit,
    command: EditRecurringRuleCommand,
  ): DomainResult<RecurringRuleChange>;
  deactivateRule(
    unit: TUnit,
    command: DeactivateRecurringRuleCommand,
  ): DomainResult<RecurringRuleChange>;
}

/** Builds the lifecycle services. */
export function createRecurringLifecycle<TUnit extends UnitOfWork>(
  deps: RecurringLifecycleDeps<TUnit>,
): RecurringLifecycle<TUnit> {
  const clock = deps.clock ?? new SystemClock();
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? Date.now;
  const maintenance = createClassificationMaintenance({
    categories: deps.categories,
    tags: deps.tags,
  });
  const createTransaction = createCreateTransaction({
    transactions: deps.transactions,
    categories: deps.categories,
    tags: deps.tags,
    clock,
    createId,
    now,
  });

  return {
    previewNextDueDate(command) {
      return previewNextDueDate(command, clock);
    },
    previewCatchUp(unit, command) {
      return previewCatchUp(unit, command, deps.rules, clock);
    },
    listActiveRules(unit, command) {
      return listActiveRules(unit, command, deps.rules);
    },
    activateFromTransaction(unit, command) {
      return activateFromTransaction(
        unit,
        command,
        deps,
        maintenance,
        clock,
        createId,
        now,
      );
    },
    activateWithNewTransaction(unit, command) {
      return activateWithNewTransaction(
        unit,
        command,
        deps,
        createTransaction,
        clock,
        createId,
        now,
      );
    },
    editRule(unit, command) {
      return editActiveRule(
        unit,
        command,
        deps,
        maintenance,
        clock,
        createId,
        now,
      );
    },
    deactivateRule(unit, command) {
      return deactivateActiveRule(unit, command, deps, clock, createId, now);
    },
  };
}

function previewNextDueDate(
  command: PreviewNextDueDateCommand,
  clock: Clock,
): DomainResult<{ readonly nextDueDate: LocalDate }> {
  const monthlyDay = readMonthlyDay(command.monthlyDay);

  if (!monthlyDay.ok) {
    return monthlyDay;
  }

  const after =
    command.after === undefined
      ? { ok: true as const, value: clock.today() }
      : parseAfter(command.after);

  if (!after.ok) {
    return after;
  }

  const next = nextDueDateAfter(after.value, monthlyDay.value);

  if (!next.ok) {
    return invalid([domainError("nextDueDate", "invalidDate")]);
  }

  return valid({ nextDueDate: next.value });
}

function previewCatchUp<TUnit extends UnitOfWork>(
  unit: TUnit,
  command: PreviewCatchUpCommand,
  rules: RecurringRuleRepository<TUnit>,
  clock: Clock,
): DomainResult<CatchUpPreview> {
  const ruleId = readRuleId(command.ruleId);

  if (!ruleId.ok) {
    return ruleId;
  }

  const stored = rules.findRuleForUpdate(unit, {
    workspaceId: command.workspaceId,
    ruleId: ruleId.value,
  });

  if (!stored.ok) {
    return fromRecurringResult(stored);
  }

  if (stored.value === null) {
    return invalid([domainError("id", "notFound")]);
  }

  if (!isActiveRecurringRule(stored.value.rule)) {
    return invalid([domainError("deactivatedAt", "alreadyDeactivated")]);
  }

  const schedule = resolveDueSchedule(
    stored.value.rule.nextDueDate,
    stored.value.rule.monthlyDay,
    clock.today(),
  );

  if (!schedule.ok) {
    return invalid([domainError("nextDueDate", "invalidDate")]);
  }

  return valid({
    pending: schedule.value.pending,
    rule: stored.value.rule,
  });
}

function listActiveRules<TUnit extends UnitOfWork>(
  unit: TUnit,
  command: ListActiveRulesCommand,
  rules: RecurringRuleRepository<TUnit>,
): DomainResult<ActiveRulesList> {
  const listed = rules.findActiveRules(unit, {
    workspaceId: command.workspaceId,
  });

  if (!listed.ok) {
    return fromRecurringResult(listed);
  }

  return valid({
    expenses: listed.value.filter(
      (row) => row.rule.template.type === "expense",
    ),
    incomes: listed.value.filter((row) => row.rule.template.type === "income"),
  });
}

function activateFromTransaction<TUnit extends UnitOfWork>(
  unit: TUnit,
  command: ActivateFromTransactionCommand,
  deps: RecurringLifecycleDeps<TUnit>,
  maintenance: ReturnType<typeof createClassificationMaintenance<TUnit>>,
  clock: Clock,
  createId: () => string,
  now: () => number,
): DomainResult<RecurringRule> {
  if (!unit.isTransactional) {
    return invalid([domainError("storage", "unavailable")]);
  }

  if (!isIdentifier(command.transactionId)) {
    return invalid([domainError("transactionId", "invalidIdentifier")]);
  }

  const monthlyDay = readMonthlyDay(command.monthlyDay);

  if (!monthlyDay.ok) {
    return monthlyDay;
  }

  const existing = deps.rules.findActiveRuleBySource(unit, {
    workspaceId: command.workspaceId,
    sourceTransactionId: command.transactionId as TransactionId,
  });

  if (!existing.ok) {
    return fromRecurringResult(existing);
  }

  if (existing.value !== null) {
    return invalid([domainError("sourceTransactionId", "activeRuleExists")]);
  }

  const movement = deps.transactions.findTransactionById(unit, {
    workspaceId: command.workspaceId,
    transactionId: command.transactionId as TransactionId,
  });

  if (!movement.ok) {
    return invalid([toTransactionDomainError(movement.error.code)]);
  }

  if (movement.value === null) {
    return invalid([domainError("transactionId", "notFound")]);
  }

  const category = maintenance.requireAssignableCategory(unit, {
    workspaceId: command.workspaceId,
    categoryId: movement.value.categoryId,
    type: movement.value.type,
  });

  if (!category.ok) {
    return category;
  }

  return insertActiveRule(unit, deps.rules, {
    workspaceId: command.workspaceId,
    sourceTransactionId: movement.value.id,
    type: movement.value.type,
    amountMinor: movement.value.amountMinor,
    category: category.value,
    concept: movement.value.concept,
    note: movement.value.note,
    tagIds: movement.value.tagIds,
    monthlyDay: monthlyDay.value,
    clock,
    createId,
    now,
  });
}

function activateWithNewTransaction<TUnit extends UnitOfWork>(
  unit: TUnit,
  command: ActivateWithNewTransactionCommand,
  deps: RecurringLifecycleDeps<TUnit>,
  createTransaction: CreateTransaction<TUnit>,
  clock: Clock,
  createId: () => string,
  now: () => number,
): DomainResult<ActivatedWithTransaction> {
  if (!unit.isTransactional) {
    return invalid([domainError("storage", "unavailable")]);
  }

  const monthlyDay = readMonthlyDay(command.monthlyDay);

  if (!monthlyDay.ok) {
    return monthlyDay;
  }

  const created = createTransaction.execute(unit, command);

  if (!created.ok) {
    return created;
  }

  const category = deps.categories.findCategoryById(unit, {
    workspaceId: command.workspaceId,
    categoryId: created.value.categoryId,
  });

  if (!category.ok) {
    return invalid([domainError("categoryId", "notFound")]);
  }

  if (category.value === null) {
    return invalid([domainError("categoryId", "notFound")]);
  }

  const inserted = insertActiveRule(unit, deps.rules, {
    workspaceId: command.workspaceId,
    sourceTransactionId: created.value.id,
    type: created.value.type,
    amountMinor: created.value.amountMinor,
    category: category.value,
    concept: created.value.concept,
    note: created.value.note,
    tagIds: created.value.tagIds,
    monthlyDay: monthlyDay.value,
    clock,
    createId,
    now,
  });

  if (!inserted.ok) {
    return inserted;
  }

  return valid({ transaction: created.value, rule: inserted.value });
}

function editActiveRule<TUnit extends UnitOfWork>(
  unit: TUnit,
  command: EditRecurringRuleCommand,
  deps: RecurringLifecycleDeps<TUnit>,
  maintenance: ReturnType<typeof createClassificationMaintenance<TUnit>>,
  clock: Clock,
  createId: () => string,
  now: () => number,
): DomainResult<RecurringRuleChange> {
  if (!unit.isTransactional) {
    return invalid([domainError("storage", "unavailable")]);
  }

  const loaded = loadActiveRuleForChange(unit, command, deps.rules);

  if (!loaded.ok) {
    return loaded;
  }

  const monthlyDay = readMonthlyDay(command.monthlyDay);

  if (!monthlyDay.ok) {
    return monthlyDay;
  }

  const category = maintenance.requireAssignableCategory(unit, {
    workspaceId: command.workspaceId,
    categoryId: command.categoryId,
    type: command.type,
  });

  if (!category.ok) {
    return category;
  }

  const resolved = resolveTags(
    unit,
    deps.tags,
    { workspaceId: command.workspaceId, tags: command.tags ?? [] },
    { createId },
  );

  if (!resolved.ok) {
    return resolved;
  }

  const caughtUp = catchUpDueDatesInUnit(unit, {
    workspaceId: command.workspaceId,
    ruleId: loaded.value.rule.id,
    today: clock.today(),
    deps,
    createId,
    now,
  });

  if (!caughtUp.ok) {
    return fromRecurringResult(caughtUp);
  }

  const nextDueDate = nextDueDateAfter(clock.today(), monthlyDay.value);

  if (!nextDueDate.ok) {
    return invalid([domainError("nextDueDate", "invalidDate")]);
  }

  const writtenAt = toTimestamp("updatedAt", now());

  if (!writtenAt.ok) {
    return writtenAt;
  }

  const edited = editRecurringRule(loaded.value.rule, {
    type: command.type,
    amountMinor: command.amountMinor,
    category: category.value,
    concept: command.concept,
    note: command.note,
    tagIds: resolved.value.map((tag) => tag.id),
    monthlyDay: monthlyDay.value,
    nextDueDate: nextDueDate.value,
    updatedAt: writtenAt.value,
  });

  if (!edited.ok) {
    return edited;
  }

  const replaced = deps.rules.replaceActiveRule(unit, {
    workspaceId: command.workspaceId,
    expectedTemplateVersion: command.templateVersion,
    rule: edited.value,
  });

  if (!replaced.ok) {
    return fromRecurringResult(replaced);
  }

  return valid({ rule: replaced.value, generated: caughtUp.value });
}

function deactivateActiveRule<TUnit extends UnitOfWork>(
  unit: TUnit,
  command: DeactivateRecurringRuleCommand,
  deps: RecurringLifecycleDeps<TUnit>,
  clock: Clock,
  createId: () => string,
  now: () => number,
): DomainResult<RecurringRuleChange> {
  if (!unit.isTransactional) {
    return invalid([domainError("storage", "unavailable")]);
  }

  const loaded = loadActiveRuleForChange(unit, command, deps.rules);

  if (!loaded.ok) {
    return loaded;
  }

  const caughtUp = catchUpDueDatesInUnit(unit, {
    workspaceId: command.workspaceId,
    ruleId: loaded.value.rule.id,
    today: clock.today(),
    deps,
    createId,
    now,
  });

  if (!caughtUp.ok) {
    return fromRecurringResult(caughtUp);
  }

  const writtenAt = toTimestamp("deactivatedAt", now());

  if (!writtenAt.ok) {
    return writtenAt;
  }

  const stopped = deactivateRecurringRule(loaded.value.rule, writtenAt.value);

  if (!stopped.ok) {
    return stopped;
  }

  const saved = deps.rules.deactivateRule(unit, {
    workspaceId: command.workspaceId,
    ruleId: loaded.value.rule.id,
    expectedTemplateVersion: command.templateVersion,
    deactivatedAt: writtenAt.value,
  });

  if (!saved.ok) {
    return fromRecurringResult(saved);
  }

  return valid({ rule: saved.value, generated: caughtUp.value });
}

function loadActiveRuleForChange<TUnit extends UnitOfWork>(
  unit: TUnit,
  command: {
    readonly workspaceId: string;
    readonly ruleId: string;
    readonly templateVersion: number;
  },
  rules: RecurringRuleRepository<TUnit>,
): DomainResult<StoredRecurringRule> {
  const ruleId = readRuleId(command.ruleId);

  if (!ruleId.ok) {
    return ruleId;
  }

  const stored = rules.findRuleForUpdate(unit, {
    workspaceId: command.workspaceId,
    ruleId: ruleId.value,
  });

  if (!stored.ok) {
    return fromRecurringResult(stored);
  }

  if (stored.value === null) {
    return invalid([domainError("id", "notFound")]);
  }

  if (!isActiveRecurringRule(stored.value.rule)) {
    return invalid([domainError("deactivatedAt", "alreadyDeactivated")]);
  }

  if (stored.value.rule.templateVersion !== command.templateVersion) {
    return invalid([domainError("templateVersion", "invalidTemplateVersion")]);
  }

  return valid(stored.value);
}

function insertActiveRule<TUnit extends UnitOfWork>(
  unit: TUnit,
  rules: RecurringRuleRepository<TUnit>,
  input: {
    readonly workspaceId: string;
    readonly sourceTransactionId: TransactionId;
    readonly type: string;
    readonly amountMinor: number;
    readonly category: Parameters<typeof createRecurringRule>[0]["category"];
    readonly concept: string | null;
    readonly note: string | null;
    readonly tagIds: readonly string[];
    readonly monthlyDay: MonthlyDay;
    readonly clock: Clock;
    readonly createId: () => string;
    readonly now: () => number;
  },
): DomainResult<RecurringRule> {
  const nextDueDate = nextDueDateAfter(input.clock.today(), input.monthlyDay);

  if (!nextDueDate.ok) {
    return invalid([domainError("nextDueDate", "invalidDate")]);
  }

  const writtenAt = toTimestamp("createdAt", input.now());

  if (!writtenAt.ok) {
    return writtenAt;
  }

  const built = createRecurringRule({
    id: input.createId(),
    sourceTransactionId: input.sourceTransactionId,
    type: input.type,
    amountMinor: input.amountMinor,
    category: input.category,
    concept: input.concept,
    note: input.note,
    tagIds: input.tagIds,
    monthlyDay: input.monthlyDay,
    nextDueDate: nextDueDate.value,
    templateVersion: INITIAL_TEMPLATE_VERSION,
    deactivatedAt: null,
    createdAt: writtenAt.value,
    updatedAt: writtenAt.value,
  });

  if (!built.ok) {
    return built;
  }

  const inserted = rules.insertRule(unit, {
    workspaceId: input.workspaceId,
    rule: built.value,
  });

  if (!inserted.ok) {
    return fromRecurringResult(inserted);
  }

  return valid(inserted.value);
}

function readMonthlyDay(value: number): DomainResult<MonthlyDay> {
  if (!isMonthlyDay(value)) {
    return invalid([domainError("monthlyDay", "invalidMonthlyDay")]);
  }

  return valid(value);
}

function readRuleId(value: string): DomainResult<RecurringRuleId> {
  if (!isIdentifier(value)) {
    return invalid([domainError("id", "invalidIdentifier")]);
  }

  return valid(value as RecurringRuleId);
}

function parseAfter(value: string): DomainResult<LocalDate> {
  const parsed = parseLocalDate(value);

  if (!parsed.ok) {
    return invalid([domainError("after", "invalidDate")]);
  }

  return parsed;
}

function fromRecurringResult<TValue>(
  result: RecurringResult<TValue>,
): DomainResult<TValue> {
  if (result.ok) {
    return valid(result.value);
  }

  return invalid([toRecurringDomainError(result.error)]);
}

function toRecurringDomainError(error: RecurringRepositoryError): DomainError {
  switch (error.code) {
    case "ruleNotFound":
      return domainError("id", "notFound");
    case "duplicateId":
      return domainError("id", "invalidIdentifier");
    case "activeRuleExists":
      return domainError("sourceTransactionId", "activeRuleExists");
    case "alreadyProcessed":
    case "staleNextDueDate":
    case "staleTemplateVersion":
      return domainError("templateVersion", "invalidTemplateVersion");
    case "alreadyDeactivated":
      return domainError("deactivatedAt", "alreadyDeactivated");
    case "occurrenceNotFound":
      return domainError("id", "notFound");
    case "unknownWorkspace":
      return domainError("workspaceId", "notFound");
    case "unknownCategory":
      return domainError("categoryId", "notFound");
    case "unknownTag":
      return domainError("tagId", "notFound");
    case "unknownTransaction":
      return domainError("transactionId", "notFound");
    case "transactionRequired":
    case "invalidStoredRow":
    case "storageFailure":
      return domainError("storage", "unavailable");
  }
}

function toTransactionDomainError(
  code: TransactionRepositoryErrorCode,
): DomainError {
  switch (code) {
    case "duplicateId":
      return domainError("id", "invalidIdentifier");
    case "transactionNotFound":
      return domainError("transactionId", "notFound");
    case "unknownCategory":
      return domainError("categoryId", "notFound");
    case "unknownTag":
      return domainError("tagId", "notFound");
    case "unknownWorkspace":
      return domainError("workspaceId", "notFound");
    case "transactionRequired":
    case "invalidStoredRow":
    case "storageFailure":
      return domainError("storage", "unavailable");
  }
}
