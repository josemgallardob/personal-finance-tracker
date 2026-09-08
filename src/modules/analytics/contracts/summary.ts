/**
 * Public summary representation of the dashboard API.
 *
 * The response carries the selected period, the two intervals really compared,
 * the exact totals of both of them, the breakdowns of the interval and the
 * recent movements. Every amount is an exact integer of minor units; nothing is
 * rounded, formatted or turned into a percentage string here.
 *
 * Two rules of the accepted design are visible in the shape. The breakdowns
 * include archived classifications that have an amount in the interval, marked
 * through their own DTO, because a selection of the interface decides what is
 * drawn and never what is summed. And the tag breakdown declares itself
 * overlapping: the whole amount of a movement is attributed to each of its
 * tags, so adding the groups up does not give the total expense.
 */

import {
  toCategoryDto,
  toTagDto,
  type CategoryDto,
  type TagDto,
} from "../../classification/contracts";
import {
  toTransactionDto,
  type TransactionDto,
} from "../../transactions/contracts";
import type { ComparisonDelta } from "../domain/comparison";
import type {
  ComparisonWindow,
  DashboardPeriod,
  DashboardPeriodKind,
  DateRange,
} from "../domain/periods";
import type {
  ComparedPeriodTotals,
  DashboardSummary,
  PeriodTotals,
} from "../application/dashboard-analytics";
import type {
  CategoryExpenseTotal,
  TagExpenseBreakdown,
  TagExpenseTotal,
} from "../application/ports/analytics-repository";
import { toDrillDownDto, type DrillDownDto } from "./drill-down";

/** Inclusive interval of civil dates as the API returns it. */
export interface DateRangeDto {
  readonly start: string;
  readonly end: string;
}

/** The two intervals a comparison really contrasts, both labelled by the UI. */
export interface ComparisonWindowDto {
  readonly current: DateRangeDto;
  readonly previous: DateRangeDto;
}

/** Period the response was aggregated over, echoed back to the client. */
export interface DashboardPeriodDto {
  readonly kind: DashboardPeriodKind;
  readonly from: string | null;
  readonly to: string | null;
}

/** Income, expense and net of one interval, all from the type totals. */
export interface PeriodTotalsDto {
  readonly incomeMinor: number;
  readonly expenseMinor: number;
  readonly netMinor: number;
  readonly incomeCount: number;
  readonly expenseCount: number;
}

/**
 * Change of one figure against the equivalent previous interval.
 *
 * `deltaPercent` is hundredths of a percent, so 25,00 % is `2500`. It is null
 * only when there is no comparison base, and `reason` then says so instead of
 * letting a client draw a misleading 0 %.
 */
export interface ComparisonDeltaDto {
  readonly currentMinor: number;
  readonly previousMinor: number;
  readonly deltaMinor: number;
  readonly deltaPercent: number | null;
  readonly reason: string | null;
}

/** Totals of the selected interval contrasted with the previous one. */
export interface ComparedPeriodTotalsDto {
  readonly current: PeriodTotalsDto;
  readonly previous: PeriodTotalsDto;
  readonly income: ComparisonDeltaDto;
  readonly expense: ComparisonDeltaDto;
  readonly net: ComparisonDeltaDto;
}

/** History filters of the three cards of the selected period. */
export interface SummaryDrillDownsDto {
  readonly income: DrillDownDto;
  readonly expense: DrillDownDto;
  readonly net: DrillDownDto;
}

/** Expense one category accumulated over the interval. */
export interface CategoryExpenseDto {
  readonly category: CategoryDto;
  readonly totalMinor: number;
  readonly transactionCount: number;
  readonly drillDown: DrillDownDto;
}

/** Expense one tag accumulated over the interval. */
export interface TagExpenseDto {
  readonly tag: TagDto;
  readonly totalMinor: number;
  readonly transactionCount: number;
  readonly drillDown: DrillDownDto;
}

/** Expense of the interval that carries no tag at all. */
export interface UntaggedExpenseDto {
  readonly totalMinor: number;
  readonly transactionCount: number;
  readonly drillDown: DrillDownDto;
}

/**
 * Expense by tag, plus the computed untagged group.
 *
 * `overlapping` is always true and states the contract: a movement with several
 * tags contributes its whole amount to each group, so the groups intersect and
 * their sum is not the total expense.
 */
export interface TagExpenseBreakdownDto {
  readonly tags: readonly TagExpenseDto[];
  readonly untagged: UntaggedExpenseDto;
  readonly overlapping: true;
}

/** Summary of one dashboard response as the API returns it. */
export interface DashboardSummaryDto {
  readonly period: DashboardPeriodDto;
  readonly range: DateRangeDto;
  readonly comparison: ComparisonWindowDto;
  readonly totals: ComparedPeriodTotalsDto;
  readonly drillDowns: SummaryDrillDownsDto;
  readonly expenseByCategory: readonly CategoryExpenseDto[];
  readonly expenseByTag: TagExpenseBreakdownDto;
  readonly recentTransactions: readonly TransactionDto[];
}

/** Maps an inclusive interval to its documented representation. */
export function toDateRangeDto(range: DateRange): DateRangeDto {
  return { start: range.start, end: range.end };
}

/** Maps the compared intervals to their documented representation. */
export function toComparisonWindowDto(
  window: ComparisonWindow,
): ComparisonWindowDto {
  return {
    current: toDateRangeDto(window.current),
    previous: toDateRangeDto(window.previous),
  };
}

/** Maps the selected period back to the documented representation. */
export function toDashboardPeriodDto(
  period: DashboardPeriod,
): DashboardPeriodDto {
  if (period.kind === "customMonthRange") {
    return { kind: period.kind, from: period.from, to: period.to };
  }

  return { kind: period.kind, from: null, to: null };
}

function toPeriodTotalsDto(totals: PeriodTotals): PeriodTotalsDto {
  return {
    incomeMinor: totals.incomeMinor,
    expenseMinor: totals.expenseMinor,
    netMinor: totals.netMinor,
    incomeCount: totals.incomeCount,
    expenseCount: totals.expenseCount,
  };
}

function toComparisonDeltaDto(delta: ComparisonDelta): ComparisonDeltaDto {
  return {
    currentMinor: delta.currentMinor,
    previousMinor: delta.previousMinor,
    deltaMinor: delta.deltaMinor,
    deltaPercent: delta.deltaPercent,
    reason: delta.reason,
  };
}

function toComparedPeriodTotalsDto(
  totals: ComparedPeriodTotals,
): ComparedPeriodTotalsDto {
  return {
    current: toPeriodTotalsDto(totals.current),
    previous: toPeriodTotalsDto(totals.previous),
    income: toComparisonDeltaDto(totals.income),
    expense: toComparisonDeltaDto(totals.expense),
    net: toComparisonDeltaDto(totals.net),
  };
}

function toSummaryDrillDownsDto(range: DateRange): SummaryDrillDownsDto {
  return {
    income: toDrillDownDto(range, { type: "income" }),
    expense: toDrillDownDto(range, { type: "expense" }),
    net: toDrillDownDto(range),
  };
}

/** Maps one category group of an interval, with its history filter. */
export function toCategoryExpenseDto(
  entry: CategoryExpenseTotal,
  range: DateRange,
): CategoryExpenseDto {
  return {
    category: toCategoryDto(entry.category),
    totalMinor: entry.totalMinor,
    transactionCount: entry.transactionCount,
    drillDown: toDrillDownDto(range, {
      type: "expense",
      categoryId: entry.category.id,
    }),
  };
}

/** Maps one tag group of an interval, with its history filter. */
export function toTagExpenseDto(
  entry: TagExpenseTotal,
  range: DateRange,
): TagExpenseDto {
  return {
    tag: toTagDto(entry.tag),
    totalMinor: entry.totalMinor,
    transactionCount: entry.transactionCount,
    drillDown: toDrillDownDto(range, {
      type: "expense",
      tags: { kind: "tag", tagId: entry.tag.id },
    }),
  };
}

/** Maps the tag breakdown of an interval, including the untagged group. */
export function toTagExpenseBreakdownDto(
  breakdown: TagExpenseBreakdown,
  range: DateRange,
): TagExpenseBreakdownDto {
  return {
    tags: breakdown.tags.map((entry) => toTagExpenseDto(entry, range)),
    untagged: {
      totalMinor: breakdown.untaggedMinor,
      transactionCount: breakdown.untaggedCount,
      drillDown: toDrillDownDto(range, {
        type: "expense",
        tags: { kind: "untagged" },
      }),
    },
    overlapping: true,
  };
}

/** Maps a dashboard summary to the documented HTTP representation. */
export function toDashboardSummaryDto(
  summary: DashboardSummary,
): DashboardSummaryDto {
  return {
    period: toDashboardPeriodDto(summary.period),
    range: toDateRangeDto(summary.range),
    comparison: toComparisonWindowDto(summary.comparison),
    totals: toComparedPeriodTotalsDto(summary.totals),
    drillDowns: toSummaryDrillDownsDto(summary.range),
    expenseByCategory: summary.expenseByCategory.map((entry) =>
      toCategoryExpenseDto(entry, summary.range),
    ),
    expenseByTag: toTagExpenseBreakdownDto(summary.expenseByTag, summary.range),
    recentTransactions: summary.recentTransactions.map(toTransactionDto),
  };
}
