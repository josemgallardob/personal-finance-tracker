/**
 * Series the dashboard charts draw and the tables that replace them.
 *
 * The mapping is pure and shared by both representations, so the picture and
 * its accessible table can never disagree: every point carries the exact minor
 * units, the EUR copy a reader receives and the history filter that explains
 * it. A chart is never the only way to reach a figure.
 *
 * Three rules of the accepted design are visible here. The monthly evolution
 * keeps its own window and states it, so it is never read as a consequence of
 * the period selector. The category breakdown adds up to the expense of the
 * period and may therefore show a share of it. The tag breakdown may not: the
 * whole amount of a movement is attributed to each of its tags, the groups
 * overlap and their sum is not the total, so the tag bars carry amounts and no
 * percentage at all, plus the computed "Sin etiquetas" group whenever the
 * window contains expense without tags.
 */

import { roundDivisionHalfAwayFromZero } from "../../../../shared/domain/money";
import type {
  MonthWindowDto,
  MonthlyEvolutionDto,
  MonthlyTotalsDto,
} from "../../contracts/evolution";
import type {
  CategoryExpenseDto,
  ComparedPeriodTotalsDto,
  ComparisonWindowDto,
  TagExpenseBreakdownDto,
} from "../../contracts/summary";
import { dashboardCopy } from "../dashboard-copy";
import { formatMonthKeyAsSpanish } from "../dashboard-period";
import {
  drillDownHistoryHref,
  formatDateRangeLabel,
  formatPercentHundredths,
  summaryAmount,
} from "../summary-presentation";

/** Identifier of the computed untagged group, which is not a stored tag. */
export const UNTAGGED_BAR_ID = "untagged";

/** Percentage scale of a share, in hundredths of a percent. */
const PERCENT_HUNDREDTHS_SCALE = 10_000;

/** Widest bar of a breakdown, as a percentage of its own track. */
const FULL_BAR_WIDTH = 100;

/** One month of the evolution series, ready to draw and to read. */
export interface MonthlyTrendPoint {
  readonly month: string;
  readonly label: string;
  readonly incomeMinor: number;
  readonly expenseMinor: number;
  readonly incomeLabel: string;
  readonly expenseLabel: string;
  readonly href: string | null;
  readonly incomeHref: string | null;
  readonly expenseHref: string | null;
}

/** One interval of the income-against-expense comparison. */
export interface IncomeExpenseBar {
  readonly key: "current" | "previous";
  readonly label: string;
  readonly rangeLabel: string;
  readonly incomeMinor: number;
  readonly expenseMinor: number;
  readonly incomeLabel: string;
  readonly expenseLabel: string;
}

/** One horizontal bar of an expense breakdown. */
export interface BreakdownBar {
  readonly id: string;
  readonly label: string;
  readonly totalMinor: number;
  readonly amountLabel: string;
  readonly transactionCount: number;
  readonly countLabel: string;
  /** Share of the period expense, or null when the groups overlap. */
  readonly shareLabel: string | null;
  /** Width of the bar against the largest one, as a percentage. */
  readonly widthPercent: number;
  readonly archived: boolean;
  readonly href: string | null;
}

function monthPoint(totals: MonthlyTotalsDto): MonthlyTrendPoint {
  return {
    month: totals.month,
    label: formatMonthKeyAsSpanish(totals.month),
    incomeMinor: totals.incomeMinor,
    expenseMinor: totals.expenseMinor,
    incomeLabel: summaryAmount(totals.incomeMinor),
    expenseLabel: summaryAmount(totals.expenseMinor),
    href: drillDownHistoryHref(totals.drillDown),
    incomeHref: drillDownHistoryHref(totals.incomeDrillDown),
    expenseHref: drillDownHistoryHref(totals.expenseDrillDown),
  };
}

/**
 * Points of the evolution series.
 *
 * A workspace with no movement at all answers `empty`, which is not a run of
 * zeroes: it produces no point, and the interface shows its empty state. A
 * month of the window without movements does produce a point at zero, so the
 * axis is not compressed.
 */
export function monthlyTrendPoints(
  evolution: MonthlyEvolutionDto,
): readonly MonthlyTrendPoint[] {
  if (evolution.kind === "empty") {
    return [];
  }

  return evolution.months.map(monthPoint);
}

/** Window copy of the series: its first month, its last one and how many. */
export function monthlyTrendWindowLabel(window: MonthWindowDto): string {
  return dashboardCopy.trendWindow(
    formatMonthKeyAsSpanish(window.start),
    formatMonthKeyAsSpanish(window.end),
    window.monthCount,
  );
}

/** The two intervals of the comparison, each with its income and expense. */
export function incomeExpenseBars(
  totals: ComparedPeriodTotalsDto,
  comparison: ComparisonWindowDto,
): readonly IncomeExpenseBar[] {
  return [
    {
      key: "current",
      label: dashboardCopy.comparisonCurrent,
      rangeLabel: formatDateRangeLabel(comparison.current),
      incomeMinor: totals.current.incomeMinor,
      expenseMinor: totals.current.expenseMinor,
      incomeLabel: summaryAmount(totals.current.incomeMinor),
      expenseLabel: summaryAmount(totals.current.expenseMinor),
    },
    {
      key: "previous",
      label: dashboardCopy.comparisonPrevious,
      rangeLabel: formatDateRangeLabel(comparison.previous),
      incomeMinor: totals.previous.incomeMinor,
      expenseMinor: totals.previous.expenseMinor,
      incomeLabel: summaryAmount(totals.previous.incomeMinor),
      expenseLabel: summaryAmount(totals.previous.expenseMinor),
    },
  ];
}

/**
 * Width of a bar against the largest one of its breakdown.
 *
 * The division is exact integer arithmetic over minor units. A breakdown whose
 * largest amount is zero draws no width at all instead of dividing by zero.
 */
function barWidth(totalMinor: number, largestMinor: number): number {
  if (largestMinor <= 0) {
    return 0;
  }

  const width = roundDivisionHalfAwayFromZero(
    totalMinor * FULL_BAR_WIDTH,
    largestMinor,
  );

  return width.ok ? width.value : 0;
}

/**
 * Share of one amount over the expense of the period.
 *
 * Returns null when there is nothing to divide by, so a breakdown of an empty
 * period never claims that a group is 0 % of it.
 */
function shareLabel(totalMinor: number, expenseMinor: number): string | null {
  if (expenseMinor <= 0) {
    return null;
  }

  const share = roundDivisionHalfAwayFromZero(
    totalMinor * PERCENT_HUNDREDTHS_SCALE,
    expenseMinor,
  );

  if (!share.ok) {
    return null;
  }

  return dashboardCopy.shareOfExpense(
    formatPercentHundredths(share.value).replace("+", ""),
  );
}

function largestAmount(amounts: readonly number[]): number {
  return amounts.reduce((largest, amount) => Math.max(largest, amount), 0);
}

/**
 * Bars of the expense by category of the selected period.
 *
 * The groups are disjoint and add up to the expense of the period, so each one
 * carries its share of it. An archived category that has an amount in the
 * window keeps its bar and is marked as archived: its amount already counts in
 * the totals, and hiding it would make the breakdown disagree with the cards.
 */
export function expenseCategoryBars(
  entries: readonly CategoryExpenseDto[],
  expenseMinor: number,
): readonly BreakdownBar[] {
  const largest = largestAmount(entries.map((entry) => entry.totalMinor));

  return entries.map((entry) => ({
    id: entry.category.id,
    label: entry.category.name,
    totalMinor: entry.totalMinor,
    amountLabel: summaryAmount(entry.totalMinor),
    transactionCount: entry.transactionCount,
    countLabel: dashboardCopy.movementCount(entry.transactionCount),
    shareLabel: shareLabel(entry.totalMinor, expenseMinor),
    widthPercent: barWidth(entry.totalMinor, largest),
    archived: entry.category.isArchived,
    href: drillDownHistoryHref(entry.drillDown),
  }));
}

/**
 * Bars of the expense by tag, plus the computed untagged group.
 *
 * The groups overlap, so no bar carries a percentage of the total. The
 * untagged group is not a stored tag: it is added only when the window really
 * contains expense without tags, and it is never mixed into the tag rows of
 * the response.
 */
export function expenseTagBars(
  breakdown: TagExpenseBreakdownDto,
): readonly BreakdownBar[] {
  const untagged = breakdown.untagged;
  const amounts = breakdown.tags.map((entry) => entry.totalMinor);
  const largest = largestAmount(
    untagged.totalMinor > 0 ? [...amounts, untagged.totalMinor] : amounts,
  );
  const bars: BreakdownBar[] = breakdown.tags.map((entry) => ({
    id: entry.tag.id,
    label: entry.tag.name,
    totalMinor: entry.totalMinor,
    amountLabel: summaryAmount(entry.totalMinor),
    transactionCount: entry.transactionCount,
    countLabel: dashboardCopy.movementCount(entry.transactionCount),
    shareLabel: null,
    widthPercent: barWidth(entry.totalMinor, largest),
    archived: entry.tag.isArchived,
    href: drillDownHistoryHref(entry.drillDown),
  }));

  if (untagged.totalMinor <= 0) {
    return bars;
  }

  return [
    ...bars,
    {
      id: UNTAGGED_BAR_ID,
      label: dashboardCopy.untagged,
      totalMinor: untagged.totalMinor,
      amountLabel: summaryAmount(untagged.totalMinor),
      transactionCount: untagged.transactionCount,
      countLabel: dashboardCopy.movementCount(untagged.transactionCount),
      shareLabel: null,
      widthPercent: barWidth(untagged.totalMinor, largest),
      archived: false,
      href: drillDownHistoryHref(untagged.drillDown),
    },
  ];
}
