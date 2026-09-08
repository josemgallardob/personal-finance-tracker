/**
 * Recurrence storage ports.
 *
 * The generator never trusts what it read outside its own SQL transaction: it
 * re-reads the rule for writing, reserves the due date and only advances the
 * rule when the date it is advancing from is still the stored one. The two
 * operations that make this safe are therefore contracts of the port, not
 * conveniences of an adapter: {@link RecurringRuleRepository.findRuleForUpdate}
 * re-reads inside the caller-owned unit, and
 * {@link RecurringRuleRepository.advanceNextDueDate} only applies when the
 * stored date still matches, so a writer that lost a race changes nothing.
 *
 * Reserving a due date is an insertion that the unique index on rule and
 * scheduled day decides. A second writer, a retry or a run that finds the
 * tombstone of a deleted movement is refused with `alreadyProcessed` instead of
 * creating a second movement for the same date.
 *
 * Every operation is scoped to a workspace, shares the caller-owned unit of
 * work and reports refusals as values instead of throwing.
 */

import type {
  Category,
  CategoryId,
} from "../../../classification/domain/category";
import type { TagId } from "../../../classification/domain/tag";
import type { TransactionId } from "../../../transactions/domain/transaction";
import type { LocalDate } from "../../../../shared/domain/dates";
import type { Timestamp } from "../../../../shared/domain/timestamp";
import type {
  RecurringOccurrence,
  RecurringOccurrenceId,
} from "../../domain/recurring-occurrence";
import type {
  RecurringRule,
  RecurringRuleId,
} from "../../domain/recurring-rule";
import type { UnitOfWork } from "./unit-of-work";

/**
 * Workspace every recurrence read and write is scoped to.
 *
 * The identifier is resolved on the server; it never travels from a client.
 */
export interface WorkspaceScope {
  readonly workspaceId: string;
}

/**
 * Stored rule together with the category its template classifies with.
 *
 * The rule keeps only the identifier of that category, but materialising a due
 * date builds a movement through the transaction contract, which needs the
 * category itself to check that it still matches the type of the template. The
 * repository already joins it to rebuild the rule, so it returns it rather than
 * making the caller issue a second read.
 */
export interface StoredRecurringRule {
  readonly rule: RecurringRule;
  readonly category: Category;
}

/** Active rules of the workspace that owe at least one date. */
export interface DueRulesQuery extends WorkspaceScope {
  /** Latest civil day a rule may owe, which is today in Madrid. */
  readonly onOrBefore: LocalDate;
}

/** Re-read of one rule inside the unit that is about to write. */
export interface RuleForUpdateQuery extends WorkspaceScope {
  readonly ruleId: RecurringRuleId;
}

/** Insertion of a rule the domain already validated, with its template tags. */
export interface InsertRuleCommand extends WorkspaceScope {
  readonly rule: RecurringRule;
}

/** Active rules of the workspace, whether they currently owe a date or not. */
export type ActiveRulesQuery = WorkspaceScope;

/** Lookup of the active rule that was created from one origin movement. */
export interface ActiveRuleBySourceQuery extends WorkspaceScope {
  readonly sourceTransactionId: TransactionId;
}

/** Lookup of an active rule whose template uses this category. */
export interface ActiveRuleByCategoryQuery extends WorkspaceScope {
  readonly categoryId: CategoryId;
}

/** Lookup of an active rule whose template uses this tag. */
export interface ActiveRuleByTagQuery extends WorkspaceScope {
  readonly tagId: TagId;
}

/**
 * Replacement of an active rule and of its template tags.
 *
 * The write applies only while the stored template version is still the one the
 * caller read, so two editors cannot both land and a catch-up that already
 * bumped the version is detected instead of overwritten.
 */
export interface ReplaceActiveRuleCommand extends WorkspaceScope {
  readonly expectedTemplateVersion: number;
  readonly rule: RecurringRule;
}

/** Irreversible stop of an active rule. */
export interface DeactivateRuleCommand extends WorkspaceScope {
  readonly ruleId: RecurringRuleId;
  readonly expectedTemplateVersion: number;
  readonly deactivatedAt: Timestamp;
}

/**
 * Conditional move of the next date of a rule.
 *
 * The update applies only while the rule is active and its stored next date is
 * still `from`, so two writers that read the same date cannot both advance it
 * and no date is ever skipped.
 */
export interface AdvanceNextDueDateCommand extends WorkspaceScope {
  readonly ruleId: RecurringRuleId;
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly updatedAt: Timestamp;
}

/** Reservation of one due date of one rule, without its movement yet. */
export interface ReserveOccurrenceCommand extends WorkspaceScope {
  readonly occurrence: RecurringOccurrence;
}

/** Link of a reserved due date to the movement that materialised it. */
export interface LinkGeneratedTransactionCommand extends WorkspaceScope {
  readonly occurrenceId: RecurringOccurrenceId;
  readonly transactionId: TransactionId;
}

/**
 * Clearing of the movement link of a processed due date.
 *
 * The reservation stays. Only the pointer is emptied, which is the tombstone
 * a deleted generated entry leaves so the date is never materialised again.
 */
export interface ClearGeneratedTransactionCommand extends WorkspaceScope {
  readonly transactionId: TransactionId;
}

/** Reason why a recurrence repository refused an operation. */
export type RecurringRepositoryErrorCode =
  /** No rule with that identifier exists inside the scoped workspace. */
  | "ruleNotFound"
  /** A rule or an occurrence with that identifier already exists. */
  | "duplicateId"
  /** That rule already processed that scheduled day. */
  | "alreadyProcessed"
  /** The stored next date is no longer the one the caller advanced from. */
  | "staleNextDueDate"
  /** The stored template version is no longer the one the caller read. */
  | "staleTemplateVersion"
  /** The rule has already been deactivated. */
  | "alreadyDeactivated"
  /** The origin movement already has an active rule. */
  | "activeRuleExists"
  /** No reserved occurrence with that identifier exists. */
  | "occurrenceNotFound"
  /** The scoped workspace does not exist. */
  | "unknownWorkspace"
  /** The workspace has no category with that identifier and type. */
  | "unknownCategory"
  /** The workspace has no tag with one of those identifiers. */
  | "unknownTag"
  /** The workspace has no movement with that identifier. */
  | "unknownTransaction"
  /** The operation writes several rows and needs a transactional unit. */
  | "transactionRequired"
  /** A stored row does not satisfy the domain contract that wrote it. */
  | "invalidStoredRow"
  /** The storage engine failed for a reason the port does not model. */
  | "storageFailure";

/** Refusal of a recurrence repository operation. */
export interface RecurringRepositoryError {
  readonly code: RecurringRepositoryErrorCode;
  /** Technical detail kept for logs. Never carries personal data. */
  readonly cause?: string;
}

/** Outcome of a recurrence repository operation. */
export type RecurringResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: RecurringRepositoryError };

/** Accepted outcome carrying the stored representation. */
export function succeeded<TValue>(value: TValue): RecurringResult<TValue> {
  return { ok: true, value };
}

/** Refused outcome carrying the reason and an optional technical detail. */
export function failed<TValue>(
  code: RecurringRepositoryErrorCode,
  cause?: string,
): RecurringResult<TValue> {
  return { ok: false, error: cause === undefined ? { code } : { code, cause } };
}

/** Focused storage contract of recurrence rules. */
export interface RecurringRuleRepository<
  TUnitOfWork extends UnitOfWork = UnitOfWork,
> {
  /**
   * Reads the active rules of the workspace whose next date is not after the
   * given day, with their template tags and template category, ordered by next
   * date and identifier so a run is reproducible. A deactivated rule never
   * appears, whatever date it stopped on.
   */
  findDueRules(
    unit: TUnitOfWork,
    query: DueRulesQuery,
  ): RecurringResult<readonly StoredRecurringRule[]>;

  /**
   * Re-reads one rule of the workspace inside the caller-owned unit, or `null`
   * when the workspace has no rule with that identifier. The caller uses it to
   * revalidate that the rule is still active and still owes the date it is
   * about to materialise, so a decision taken outside the transaction is never
   * acted upon inside it.
   */
  findRuleForUpdate(
    unit: TUnitOfWork,
    query: RuleForUpdateQuery,
  ): RecurringResult<StoredRecurringRule | null>;

  /**
   * Inserts a rule and its template tag associations, and returns the stored
   * rule. It writes more than one row, so it requires a transactional unit.
   */
  insertRule(
    unit: TUnitOfWork,
    command: InsertRuleCommand,
  ): RecurringResult<RecurringRule>;

  /**
   * Reads every active rule of the workspace, with its template tags and
   * category, ordered by type, next date and identifier. Deactivated rules are
   * absent, including those that still have a next date in the past.
   */
  findActiveRules(
    unit: TUnitOfWork,
    query: ActiveRulesQuery,
  ): RecurringResult<readonly StoredRecurringRule[]>;

  /**
   * Reads the active rule created from one origin movement, or `null` when that
   * movement has none. A deactivated rule of the same origin is invisible here.
   */
  findActiveRuleBySource(
    unit: TUnitOfWork,
    query: ActiveRuleBySourceQuery,
  ): RecurringResult<StoredRecurringRule | null>;

  /**
   * Reads one active rule whose template classifies with this category, or
   * `null` when none does. Archive uses it to refuse while a rule still copies
   * that category into generated movements.
   */
  findActiveRuleByCategory(
    unit: TUnitOfWork,
    query: ActiveRuleByCategoryQuery,
  ): RecurringResult<StoredRecurringRule | null>;

  /**
   * Reads one active rule whose template carries this tag, or `null` when none
   * does. Archive uses it the same way as the category lookup.
   */
  findActiveRuleByTag(
    unit: TUnitOfWork,
    query: ActiveRuleByTagQuery,
  ): RecurringResult<StoredRecurringRule | null>;

  /**
   * Replaces an active rule and its template tags, and returns the stored rule.
   * It writes more than one row, so it requires a transactional unit. The write
   * is refused with `staleTemplateVersion` when another editor already landed,
   * and with `alreadyDeactivated` when the rule has stopped generating.
   */
  replaceActiveRule(
    unit: TUnitOfWork,
    command: ReplaceActiveRuleCommand,
  ): RecurringResult<RecurringRule>;

  /**
   * Stops an active rule for good. The stamp is refused with
   * `alreadyDeactivated` when the rule had already stopped, and with
   * `staleTemplateVersion` when the caller was looking at an older template.
   */
  deactivateRule(
    unit: TUnitOfWork,
    command: DeactivateRuleCommand,
  ): RecurringResult<RecurringRule>;

  /**
   * Moves the next date of an active rule from one day to another, and returns
   * the day it moved to. The move is refused with `staleNextDueDate` when the
   * rule was deactivated or when its stored date is no longer the one the
   * caller read, which is what stops two concurrent runs from both advancing
   * the same rule.
   */
  advanceNextDueDate(
    unit: TUnitOfWork,
    command: AdvanceNextDueDateCommand,
  ): RecurringResult<LocalDate>;
}

/** Focused storage contract of processed due dates. */
export interface RecurringOccurrenceRepository<
  TUnitOfWork extends UnitOfWork = UnitOfWork,
> {
  /**
   * Reserves one due date of one rule, without a movement yet, and returns the
   * stored reservation. A date that any earlier run already processed is
   * refused with `alreadyProcessed`, including the tombstone a deleted
   * generated movement leaves behind, so no date is ever materialised twice.
   */
  reserveOccurrence(
    unit: TUnitOfWork,
    command: ReserveOccurrenceCommand,
  ): RecurringResult<RecurringOccurrence>;

  /**
   * Links a reserved due date to the movement that materialised it, and
   * returns the stored reservation. Deleting that movement later clears the
   * link without removing the reservation, which is what keeps the date
   * processed for good.
   */
  linkGeneratedTransaction(
    unit: TUnitOfWork,
    command: LinkGeneratedTransactionCommand,
  ): RecurringResult<RecurringOccurrence>;

  /**
   * Empties the movement link of the processed date that created this
   * transaction, and returns the tombstone. `null` means the movement was not
   * generated by a rule. The reservation itself is never deleted.
   */
  clearGeneratedTransaction(
    unit: TUnitOfWork,
    command: ClearGeneratedTransactionCommand,
  ): RecurringResult<RecurringOccurrence | null>;
}
