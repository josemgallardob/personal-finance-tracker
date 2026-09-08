/**
 * Dashboard analytics services.
 *
 * Three reads compose the dashboard: the selected period with its comparison,
 * breakdowns and five recent movements; the monthly evolution series; and the
 * monthly averages. Each execute opens one snapshot so every figure of that
 * response observes the same data. The selected period never shapes the
 * evolution or the averages, and no service accepts a UI series selection:
 * globals are always the type totals of their window.
 *
 * Averages keep the exact numerator and the month divisor. Presentation
 * rounding lives in {@link presentAverageMinor} and is applied only when a
 * figure is painted. A percentage may be null, carrying {@link NO_COMPARISON_BASE}
 * instead of a deceptive 0 %.
 */

import type { Clock } from "../../../shared/domain/clock";
import type { MoneyMinor } from "../../../shared/domain/money";
import { subtractMoneyMinor } from "../../../shared/domain/money";
import type { Category } from "../../classification/domain/category";
import type { Tag } from "../../classification/domain/tag";
import type { Transaction } from "../../transactions/domain/transaction";
import {
  NO_COMPARISON_BASE,
  type ComparisonDelta,
  comparisonDelta,
} from "../domain/comparison";
import {
  type AverageWindow,
  type ComparisonWindow,
  type DashboardPeriod,
  type DateRange,
  type EvolutionWindow,
  type MonthWindow,
  averageWindow,
  dateRangeOfMonthWindow,
  evolutionWindow,
  resolveComparisonWindow,
} from "../domain/periods";
import type {
  AnalyticsRepository,
  AnalyticsRepositoryErrorCode,
  AnalyticsResult,
  CategoryExpenseTotal,
  MonthlyTotals,
  TagExpenseBreakdown,
  TypeTotals,
} from "./ports/analytics-repository";
import {
  RECENT_TRANSACTION_COUNT,
  failed,
  succeeded,
} from "./ports/analytics-repository";
import type { AnalyticsSnapshotRunner } from "./ports/analytics-snapshot";
import type { UnitOfWork } from "./ports/unit-of-work";

export { presentAverageMinor } from "../../../shared/domain/money";
export { NO_COMPARISON_BASE };

/** Workspace every dashboard read is scoped to. */
export interface WorkspaceAnalyticsQuery {
  readonly workspaceId: string;
}

/** Period the summary cards and breakdowns aggregate. */
export interface DashboardSummaryQuery extends WorkspaceAnalyticsQuery {
  readonly period: DashboardPeriod;
}

/** Reason a dashboard analytics service refused a response. */
export type DashboardAnalyticsErrorCode =
  AnalyticsRepositoryErrorCode | "invalidMonthRange" | "monthOutOfRange";

/** Refusal of a dashboard analytics service. */
export interface DashboardAnalyticsError {
  readonly code: DashboardAnalyticsErrorCode;
  readonly cause?: string;
}

/** Outcome of a dashboard analytics service. */
export type DashboardAnalyticsResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: DashboardAnalyticsError };

/** Income, expense and net of one interval, all from the type totals. */
export interface PeriodTotals {
  readonly incomeMinor: MoneyMinor;
  readonly expenseMinor: MoneyMinor;
  readonly netMinor: MoneyMinor;
  readonly incomeCount: number;
  readonly expenseCount: number;
}

/** Totals of the selected interval contrasted with the equivalent previous one. */
export interface ComparedPeriodTotals {
  readonly current: PeriodTotals;
  readonly previous: PeriodTotals;
  readonly income: ComparisonDelta;
  readonly expense: ComparisonDelta;
  readonly net: ComparisonDelta;
}

/**
 * Summary of one dashboard response.
 *
 * Breakdowns include archived classifications that still have amount in the
 * period. They are never filtered by a UI series selection: that choice only
 * decides what is drawn.
 */
export interface DashboardSummary {
  readonly period: DashboardPeriod;
  readonly range: DateRange;
  readonly comparison: ComparisonWindow;
  readonly totals: ComparedPeriodTotals;
  readonly expenseByCategory: readonly CategoryExpenseTotal[];
  readonly expenseByTag: TagExpenseBreakdown;
  readonly recentTransactions: readonly Transaction[];
}

/** Monthly evolution series of one dashboard response. */
export type MonthlyEvolution =
  | { readonly kind: "empty" }
  | {
      readonly kind: "months";
      readonly window: MonthWindow;
      readonly months: readonly MonthlyTotals[];
    };

/** Exact average: the numerator and the divisor, before any display rounding. */
export interface ExactAverage {
  readonly totalMinor: MoneyMinor;
  readonly monthCount: number;
}

/** Average of one classification group, still carrying its identity. */
export interface CategoryExactAverage extends ExactAverage {
  readonly category: Category;
  readonly transactionCount: number;
}

/** Average of one overlapping tag group. */
export interface TagExactAverage extends ExactAverage {
  readonly tag: Tag;
  readonly transactionCount: number;
}

/**
 * Monthly averages of one dashboard response.
 *
 * `insufficientHistory` is distinct from a window that contains a month of
 * zeroes: the former has no divisor, the latter still divides by that month.
 */
export type MonthlyAverages =
  | { readonly kind: "insufficientHistory" }
  | {
      readonly kind: "months";
      readonly window: MonthWindow;
      readonly totalExpense: ExactAverage;
      readonly net: ExactAverage;
      readonly byCategory: readonly CategoryExactAverage[];
      readonly byTag: readonly TagExactAverage[];
      readonly untagged: ExactAverage;
    };

/** Collaborators of the three dashboard services. */
export interface DashboardAnalyticsDeps<TUnit extends UnitOfWork> {
  readonly analytics: AnalyticsRepository<TUnit>;
  readonly clock: Clock;
  readonly snapshots: AnalyticsSnapshotRunner<TUnit>;
}

/** Three services that each open one snapshot per response. */
export interface DashboardAnalytics {
  readSummary(
    query: DashboardSummaryQuery,
  ): DashboardAnalyticsResult<DashboardSummary>;
  readEvolution(
    query: WorkspaceAnalyticsQuery,
  ): DashboardAnalyticsResult<MonthlyEvolution>;
  readAverages(
    query: WorkspaceAnalyticsQuery,
  ): DashboardAnalyticsResult<MonthlyAverages>;
}

/** Builds the three dashboard analytics services. */
export function createDashboardAnalytics<TUnit extends UnitOfWork>(
  deps: DashboardAnalyticsDeps<TUnit>,
): DashboardAnalytics {
  return {
    readSummary(query) {
      return readSummary(deps, query);
    },
    readEvolution(query) {
      return readEvolution(deps, query);
    },
    readAverages(query) {
      return readAverages(deps, query);
    },
  };
}

function refused<TValue>(
  code: "invalidMonthRange" | "monthOutOfRange",
): DashboardAnalyticsResult<TValue> {
  return { ok: false, error: { code } };
}

function readSummary<TUnit extends UnitOfWork>(
  deps: DashboardAnalyticsDeps<TUnit>,
  query: DashboardSummaryQuery,
): DashboardAnalyticsResult<DashboardSummary> {
  const comparison = resolveComparisonWindow(query.period, deps.clock.today());

  if (!comparison.ok) {
    return refused(comparison.error);
  }

  return deps.snapshots.runInSnapshot<DashboardSummary>((unit) => {
    const current = deps.analytics.readTypeTotals(unit, {
      workspaceId: query.workspaceId,
      range: comparison.value.current,
    });

    if (!current.ok) {
      return current;
    }

    const previous = deps.analytics.readTypeTotals(unit, {
      workspaceId: query.workspaceId,
      range: comparison.value.previous,
    });

    if (!previous.ok) {
      return previous;
    }

    const totals = comparedTotals(current.value, previous.value);

    if (!totals.ok) {
      return totals;
    }

    const expenseByCategory = deps.analytics.readExpenseByCategory(unit, {
      workspaceId: query.workspaceId,
      range: comparison.value.current,
    });

    if (!expenseByCategory.ok) {
      return expenseByCategory;
    }

    const expenseByTag = deps.analytics.readExpenseByTag(unit, {
      workspaceId: query.workspaceId,
      range: comparison.value.current,
    });

    if (!expenseByTag.ok) {
      return expenseByTag;
    }

    const recentTransactions = deps.analytics.readRecentTransactions(unit, {
      workspaceId: query.workspaceId,
      limit: RECENT_TRANSACTION_COUNT,
    });

    if (!recentTransactions.ok) {
      return recentTransactions;
    }

    return succeeded({
      period: query.period,
      range: comparison.value.current,
      comparison: comparison.value,
      totals: totals.value,
      expenseByCategory: expenseByCategory.value,
      expenseByTag: expenseByTag.value,
      recentTransactions: recentTransactions.value,
    });
  });
}

function readEvolution<TUnit extends UnitOfWork>(
  deps: DashboardAnalyticsDeps<TUnit>,
  query: WorkspaceAnalyticsQuery,
): DashboardAnalyticsResult<MonthlyEvolution> {
  return deps.snapshots.runInSnapshot<MonthlyEvolution>((unit) => {
    const firstDate = deps.analytics.findFirstTransactionDate(unit, {
      workspaceId: query.workspaceId,
    });

    if (!firstDate.ok) {
      return firstDate;
    }

    const window: EvolutionWindow = evolutionWindow(
      deps.clock.today(),
      firstDate.value,
    );

    if (window.kind === "empty") {
      return succeeded({ kind: "empty" });
    }

    const months = deps.analytics.readMonthlyTotals(unit, {
      workspaceId: query.workspaceId,
      months: window.months,
    });

    if (!months.ok) {
      return months;
    }

    return succeeded({
      kind: "months",
      window: {
        start: window.start,
        end: window.end,
        months: window.months,
        monthCount: window.monthCount,
      },
      months: months.value,
    });
  });
}

function readAverages<TUnit extends UnitOfWork>(
  deps: DashboardAnalyticsDeps<TUnit>,
  query: WorkspaceAnalyticsQuery,
): DashboardAnalyticsResult<MonthlyAverages> {
  return deps.snapshots.runInSnapshot<MonthlyAverages>((unit) => {
    const firstDate = deps.analytics.findFirstTransactionDate(unit, {
      workspaceId: query.workspaceId,
    });

    if (!firstDate.ok) {
      return firstDate;
    }

    const window: AverageWindow = averageWindow(
      deps.clock.today(),
      firstDate.value,
    );

    if (window.kind === "insufficientHistory") {
      return succeeded({ kind: "insufficientHistory" });
    }

    const range = dateRangeOfMonthWindow(window);
    const totals = deps.analytics.readTypeTotals(unit, {
      workspaceId: query.workspaceId,
      range,
    });

    if (!totals.ok) {
      return totals;
    }

    const net = subtractMoneyMinor(
      totals.value.incomeMinor,
      totals.value.expenseMinor,
    );

    if (!net.ok) {
      return failed("amountOverflow");
    }

    const expenseByCategory = deps.analytics.readExpenseByCategory(unit, {
      workspaceId: query.workspaceId,
      range,
    });

    if (!expenseByCategory.ok) {
      return expenseByCategory;
    }

    const expenseByTag = deps.analytics.readExpenseByTag(unit, {
      workspaceId: query.workspaceId,
      range,
    });

    if (!expenseByTag.ok) {
      return expenseByTag;
    }

    return succeeded({
      kind: "months",
      window: {
        start: window.start,
        end: window.end,
        months: window.months,
        monthCount: window.monthCount,
      },
      totalExpense: exactAverage(totals.value.expenseMinor, window.monthCount),
      net: exactAverage(net.value, window.monthCount),
      byCategory: expenseByCategory.value.map((entry) => ({
        category: entry.category,
        transactionCount: entry.transactionCount,
        ...exactAverage(entry.totalMinor, window.monthCount),
      })),
      byTag: expenseByTag.value.tags.map((entry) => ({
        tag: entry.tag,
        transactionCount: entry.transactionCount,
        ...exactAverage(entry.totalMinor, window.monthCount),
      })),
      untagged: exactAverage(
        expenseByTag.value.untaggedMinor,
        window.monthCount,
      ),
    });
  });
}

function comparedTotals(
  current: TypeTotals,
  previous: TypeTotals,
): AnalyticsResult<ComparedPeriodTotals> {
  const currentTotals = periodTotals(current);

  if (!currentTotals.ok) {
    return currentTotals;
  }

  const previousTotals = periodTotals(previous);

  if (!previousTotals.ok) {
    return previousTotals;
  }

  const income = comparisonDelta(
    currentTotals.value.incomeMinor,
    previousTotals.value.incomeMinor,
  );

  if (!income.ok) {
    return failed("amountOverflow", income.error);
  }

  const expense = comparisonDelta(
    currentTotals.value.expenseMinor,
    previousTotals.value.expenseMinor,
  );

  if (!expense.ok) {
    return failed("amountOverflow", expense.error);
  }

  const net = comparisonDelta(
    currentTotals.value.netMinor,
    previousTotals.value.netMinor,
  );

  if (!net.ok) {
    return failed("amountOverflow", net.error);
  }

  return succeeded({
    current: currentTotals.value,
    previous: previousTotals.value,
    income: income.value,
    expense: expense.value,
    net: net.value,
  });
}

function periodTotals(totals: TypeTotals): AnalyticsResult<PeriodTotals> {
  const net = subtractMoneyMinor(totals.incomeMinor, totals.expenseMinor);

  if (!net.ok) {
    return failed("amountOverflow");
  }

  return succeeded({
    incomeMinor: totals.incomeMinor,
    expenseMinor: totals.expenseMinor,
    netMinor: net.value,
    incomeCount: totals.incomeCount,
    expenseCount: totals.expenseCount,
  });
}

function exactAverage(
  totalMinor: MoneyMinor,
  monthCount: number,
): ExactAverage {
  return { totalMinor, monthCount };
}
