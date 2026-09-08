/**
 * Analytics read port.
 *
 * The dashboard never adds up what it can see: every figure is aggregated by
 * the storage over the whole dataset of the workspace, so a total does not
 * change when the history loads another page. The port exposes exactly the
 * reads the dashboard stories need, each of them scoped to a workspace, each
 * sharing the caller-owned unit of work and each reporting its refusals as
 * values instead of throwing.
 *
 * Two rules shape the contract. Amounts stay exact integers of minor units and
 * a sum that no longer fits an exact integer is refused instead of rounded.
 * And the aggregation by tag is a separate read from the aggregation by type:
 * a movement carrying several tags contributes its whole amount to each of
 * them, so joining associations into the general totals would multiply income
 * and expense. The groups of the tag breakdown therefore overlap and their sum
 * is not the total expense.
 */

import type { Category } from "../../../classification/domain/category";
import type { Tag } from "../../../classification/domain/tag";
import type { Transaction } from "../../../transactions/domain/transaction";
import type { LocalDate, MonthKey } from "../../../../shared/domain/dates";
import type { MoneyMinor } from "../../../../shared/domain/money";
import type { DateRange } from "../../domain/periods";
import type { UnitOfWork } from "./unit-of-work";

/** Movements the dashboard lists as recent. */
export const RECENT_TRANSACTION_COUNT = 5;

/**
 * Workspace every analytics read is scoped to.
 *
 * The identifier is resolved on the server; it never travels from a client.
 */
export interface WorkspaceScope {
  readonly workspaceId: string;
}

/** Aggregation over one inclusive interval of civil dates. */
export interface DateRangeQuery extends WorkspaceScope {
  readonly range: DateRange;
}

/**
 * Aggregation over an explicit list of natural months.
 *
 * The months are given rather than derived, because the window of the evolution
 * chart and the window of the averages are different rules. Every requested
 * month comes back, so a month without movements is a zero of the series and
 * not a hole that would compress the axis or shrink an average divisor.
 */
export interface MonthlyTotalsQuery extends WorkspaceScope {
  readonly months: readonly MonthKey[];
}

/** Longest list of recent movements the dashboard asks for. */
export interface RecentTransactionsQuery extends WorkspaceScope {
  readonly limit: number;
}

/** Exact totals of both types over an interval. */
export interface TypeTotals {
  readonly incomeMinor: MoneyMinor;
  readonly expenseMinor: MoneyMinor;
  readonly incomeCount: number;
  readonly expenseCount: number;
}

/** Exact totals of both types inside one natural month. */
export interface MonthlyTotals extends TypeTotals {
  readonly month: MonthKey;
}

/**
 * Expense a category accumulated over the interval.
 *
 * An archived category with an amount in the window is reported like any other
 * one, carrying its archived timestamp: the selection of the interface decides
 * what is drawn, never what is summed.
 */
export interface CategoryExpenseTotal {
  readonly category: Category;
  readonly totalMinor: MoneyMinor;
  readonly transactionCount: number;
}

/** Expense a tag accumulated over the interval, with the same archiving rule. */
export interface TagExpenseTotal {
  readonly tag: Tag;
  readonly totalMinor: MoneyMinor;
  readonly transactionCount: number;
}

/**
 * Expense by tag, plus the expense that carries no tag at all.
 *
 * The untagged group is computed, never a row of the tag table. Its amount is
 * disjoint from every tag group, while the tag groups overlap each other.
 */
export interface TagExpenseBreakdown {
  readonly tags: readonly TagExpenseTotal[];
  readonly untaggedMinor: MoneyMinor;
  readonly untaggedCount: number;
}

/** Reason why an analytics repository refused a read. */
export type AnalyticsRepositoryErrorCode =
  /** An exact sum no longer fits an integer that can be serialized safely. */
  | "amountOverflow"
  /** A stored row does not satisfy the domain contract that wrote it. */
  | "invalidStoredRow"
  /** The storage engine failed for a reason the port does not model. */
  | "storageFailure";

/** Refusal of an analytics repository read. */
export interface AnalyticsRepositoryError {
  readonly code: AnalyticsRepositoryErrorCode;
  /** Technical detail kept for logs. Never carries personal data. */
  readonly cause?: string;
}

/** Outcome of an analytics repository read. */
export type AnalyticsResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: AnalyticsRepositoryError };

/** Accepted outcome carrying the aggregated value. */
export function succeeded<TValue>(value: TValue): AnalyticsResult<TValue> {
  return { ok: true, value };
}

/** Refused outcome carrying the reason and an optional technical detail. */
export function failed<TValue>(
  code: AnalyticsRepositoryErrorCode,
  cause?: string,
): AnalyticsResult<TValue> {
  return { ok: false, error: cause === undefined ? { code } : { code, cause } };
}

/** Focused read contract of the dashboard aggregations. */
export interface AnalyticsRepository<
  TUnitOfWork extends UnitOfWork = UnitOfWork,
> {
  /**
   * Sums income and expense of the workspace over the interval, counting each
   * movement once. It never reads the tag associations, so a movement with
   * several tags is not multiplied here.
   */
  readTypeTotals(
    unit: TUnitOfWork,
    query: DateRangeQuery,
  ): AnalyticsResult<TypeTotals>;

  /**
   * Sums income and expense of every requested month, in the requested order.
   * A month without movements comes back with both totals at zero.
   */
  readMonthlyTotals(
    unit: TUnitOfWork,
    query: MonthlyTotalsQuery,
  ): AnalyticsResult<readonly MonthlyTotals[]>;

  /**
   * Sums the expense of the interval by category, including archived
   * categories that have an amount in it. The result is ordered by amount
   * descending, and by name and identifier when two categories tie.
   */
  readExpenseByCategory(
    unit: TUnitOfWork,
    query: DateRangeQuery,
  ): AnalyticsResult<readonly CategoryExpenseTotal[]>;

  /**
   * Sums the expense of the interval by tag and, separately, the expense with
   * no tag. The whole amount of a movement is attributed to each of its tags,
   * so the groups overlap and adding them up does not give the total expense.
   */
  readExpenseByTag(
    unit: TUnitOfWork,
    query: DateRangeQuery,
  ): AnalyticsResult<TagExpenseBreakdown>;

  /**
   * Reads the civil date of the earliest movement of the workspace, or `null`
   * when it has none. The evolution and average windows start from it, so it
   * is read from the whole history and never from a page.
   */
  findFirstTransactionDate(
    unit: TUnitOfWork,
    scope: WorkspaceScope,
  ): AnalyticsResult<LocalDate | null>;

  /**
   * Reads the most recent movements with their tags, in the stable history
   * order. A limit of zero or less returns nothing rather than every movement.
   */
  readRecentTransactions(
    unit: TUnitOfWork,
    query: RecentTransactionsQuery,
  ): AnalyticsResult<readonly Transaction[]>;
}
