/**
 * Public monthly evolution representation of the dashboard API.
 *
 * The series is independent of the selected period: it always ends in the
 * current month and reaches at most eleven months back, or the month of the
 * first movement when the history is shorter. Months without movements are
 * materialised at zero so the axis is not compressed, and a workspace with no
 * movement at all answers `empty` instead of a run of zeroed months.
 *
 * The window travels with the series — its first month, its last month, the
 * months it contains and how many they are — so the interface can explain the
 * chart instead of inferring it from the points it received.
 */

import type { MonthlyEvolution } from "../application/dashboard-analytics";
import type { MonthlyTotals } from "../application/ports/analytics-repository";
import type { MonthWindow } from "../domain/periods";
import { dateRangeOfMonthWindow } from "../domain/periods";
import { toMonthDrillDownDto, type DrillDownDto } from "./drill-down";
import { toDateRangeDto, type DateRangeDto } from "./summary";

/** Consecutive natural months of a window as the API returns them. */
export interface MonthWindowDto {
  readonly start: string;
  readonly end: string;
  readonly months: readonly string[];
  readonly monthCount: number;
  readonly range: DateRangeDto;
}

/** Exact totals of one natural month of the series. */
export interface MonthlyTotalsDto {
  readonly month: string;
  readonly incomeMinor: number;
  readonly expenseMinor: number;
  readonly incomeCount: number;
  readonly expenseCount: number;
  readonly drillDown: DrillDownDto;
  readonly incomeDrillDown: DrillDownDto;
  readonly expenseDrillDown: DrillDownDto;
}

/**
 * Monthly evolution as the API returns it.
 *
 * `empty` is not a series of zeroes: it means the workspace has no movement,
 * and the interface shows its empty state instead of a chart.
 */
export type MonthlyEvolutionDto =
  | { readonly kind: "empty" }
  | {
      readonly kind: "months";
      readonly window: MonthWindowDto;
      readonly months: readonly MonthlyTotalsDto[];
    };

/** Maps a window of natural months, with the interval it really covers. */
export function toMonthWindowDto(window: MonthWindow): MonthWindowDto {
  return {
    start: window.start,
    end: window.end,
    months: [...window.months],
    monthCount: window.monthCount,
    range: toDateRangeDto(dateRangeOfMonthWindow(window)),
  };
}

/** Maps one month of the series, with the history filters that explain it. */
export function toMonthlyTotalsDto(totals: MonthlyTotals): MonthlyTotalsDto {
  return {
    month: totals.month,
    incomeMinor: totals.incomeMinor,
    expenseMinor: totals.expenseMinor,
    incomeCount: totals.incomeCount,
    expenseCount: totals.expenseCount,
    drillDown: toMonthDrillDownDto(totals.month),
    incomeDrillDown: toMonthDrillDownDto(totals.month, { type: "income" }),
    expenseDrillDown: toMonthDrillDownDto(totals.month, { type: "expense" }),
  };
}

/** Maps the monthly evolution to the documented HTTP representation. */
export function toMonthlyEvolutionDto(
  evolution: MonthlyEvolution,
): MonthlyEvolutionDto {
  if (evolution.kind === "empty") {
    return { kind: "empty" };
  }

  return {
    kind: "months",
    window: toMonthWindowDto(evolution.window),
    months: evolution.months.map(toMonthlyTotalsDto),
  };
}
