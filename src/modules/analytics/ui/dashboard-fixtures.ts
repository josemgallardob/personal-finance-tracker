import { vi } from "vitest";

import type { FetchLike } from "../../../shared/client/api-client";
import type { TransactionDto } from "../../transactions/contracts/transaction";
import {
  envelope,
  jsonResponse,
  maintenanceFetch,
  movement,
} from "../../transactions/ui/transaction-dialog-fixtures";
import type { DrillDownDto } from "../contracts/drill-down";
import type { MonthlyEvolutionDto } from "../contracts/evolution";
import type {
  CategoryExpenseDto,
  ComparedPeriodTotalsDto,
  DashboardSummaryDto,
  DateRangeDto,
  TagExpenseBreakdownDto,
} from "../contracts/summary";

/** Interval of the fixed period every dashboard fixture is aggregated over. */
export const currentRange: DateRangeDto = {
  start: "2026-09-01",
  end: "2026-09-08",
};

/** Equivalent previous interval, clamped to the same ordinal day. */
export const previousRange: DateRangeDto = {
  start: "2026-08-01",
  end: "2026-08-08",
};

function drillDown(
  type: DrillDownDto["type"],
  range: DateRangeDto = currentRange,
): DrillDownDto {
  return {
    dateFrom: range.start,
    dateTo: range.end,
    type,
    categoryId: null,
    tagIds: [],
    untagged: false,
  };
}

function monthTotals(month: string, incomeMinor: number, expenseMinor: number) {
  const range = {
    start: `${month}-01`,
    end: `${month}-${month === "2026-09" ? "30" : "31"}`,
  };

  return {
    month,
    incomeMinor,
    expenseMinor,
    incomeCount: incomeMinor === 0 ? 0 : 1,
    expenseCount: expenseMinor === 0 ? 0 : 2,
    drillDown: drillDown(null, range),
    incomeDrillDown: drillDown("income", range),
    expenseDrillDown: drillDown("expense", range),
  };
}

/** Income movement whose concept is empty, so its category has to name it. */
export const incomeMovement: TransactionDto = {
  id: "tx-salary",
  type: "income",
  amountMinor: 250000,
  date: "2026-09-05",
  categoryId: "cat-salary",
  concept: null,
  note: null,
  tagIds: [],
};

/**
 * Totals of the fixture period.
 *
 * The percentages are the exact hundredths the domain produces for these
 * amounts: +25,00 % of income, −19,97 % of expense and +159,90 % of net.
 */
export const totals: ComparedPeriodTotalsDto = {
  current: {
    incomeMinor: 250000,
    expenseMinor: 120050,
    netMinor: 129950,
    incomeCount: 1,
    expenseCount: 3,
  },
  previous: {
    incomeMinor: 200000,
    expenseMinor: 150000,
    netMinor: 50000,
    incomeCount: 1,
    expenseCount: 4,
  },
  income: {
    currentMinor: 250000,
    previousMinor: 200000,
    deltaMinor: 50000,
    deltaPercent: 2500,
    reason: null,
  },
  expense: {
    currentMinor: 120050,
    previousMinor: 150000,
    deltaMinor: -29950,
    deltaPercent: -1997,
    reason: null,
  },
  net: {
    currentMinor: 129950,
    previousMinor: 50000,
    deltaMinor: 79950,
    deltaPercent: 15990,
    reason: null,
  },
};

/**
 * Expense by category of the fixture period.
 *
 * The two groups add up to the 1.200,50 € of expense of the period, and one of
 * them is archived: its amount still counts, so its row is still drawn.
 */
export const expenseByCategory: readonly CategoryExpenseDto[] = [
  {
    category: {
      id: "cat-food",
      name: "Alimentación",
      type: "expense",
      isArchived: false,
    },
    totalMinor: 90000,
    transactionCount: 2,
    drillDown: { ...drillDown("expense"), categoryId: "cat-food" },
  },
  {
    category: {
      id: "cat-old",
      name: "Antigua",
      type: "expense",
      isArchived: true,
    },
    totalMinor: 30050,
    transactionCount: 1,
    drillDown: { ...drillDown("expense"), categoryId: "cat-old" },
  },
];

/**
 * Expense by tag of the fixture period.
 *
 * The groups overlap and their sum is larger than the expense of the period,
 * which is exactly what the section has to explain. The window also contains
 * expense without any tag, so the computed untagged group applies.
 */
export const expenseByTag: TagExpenseBreakdownDto = {
  tags: [
    {
      tag: { id: "tag-trips", name: "Viajes", isArchived: false },
      totalMinor: 80000,
      transactionCount: 2,
      drillDown: { ...drillDown("expense"), tagIds: ["tag-trips"] },
    },
    {
      tag: { id: "tag-old", name: "Vieja", isArchived: true },
      totalMinor: 20000,
      transactionCount: 1,
      drillDown: { ...drillDown("expense"), tagIds: ["tag-old"] },
    },
  ],
  untagged: {
    totalMinor: 40050,
    transactionCount: 1,
    drillDown: { ...drillDown("expense"), untagged: true },
  },
  overlapping: true,
};

/**
 * Monthly evolution as the API returns it.
 *
 * The window is the one the series owns, not the period of the cards, and it
 * keeps a month without movements at zero so the axis is not compressed.
 */
export const evolution: MonthlyEvolutionDto = {
  kind: "months",
  window: {
    start: "2026-07",
    end: "2026-09",
    months: ["2026-07", "2026-08", "2026-09"],
    monthCount: 3,
    range: { start: "2026-07-01", end: "2026-09-30" },
  },
  months: [
    monthTotals("2026-07", 200000, 150000),
    monthTotals("2026-08", 0, 0),
    monthTotals("2026-09", 250000, 120050),
  ],
};

/** Summary of the current month as the API returns it. */
export const summary: DashboardSummaryDto = {
  period: { kind: "currentMonth", from: null, to: null },
  range: currentRange,
  comparison: { current: currentRange, previous: previousRange },
  totals,
  drillDowns: {
    income: drillDown("income"),
    expense: drillDown("expense"),
    net: drillDown(null),
  },
  expenseByCategory,
  expenseByTag,
  recentTransactions: [incomeMovement, movement],
};

/** Builds a variant of the fixture summary. */
export function summaryWith(
  overrides: Partial<DashboardSummaryDto>,
): DashboardSummaryDto {
  return { ...summary, ...overrides };
}

/** Options of {@link dashboardFetch}. */
export interface DashboardFetchOptions {
  /** Summary each request answers with. Defaults to the fixture summary. */
  readonly summaries?: readonly DashboardSummaryDto[];
  /** Answers the summary request with this response instead of a summary. */
  readonly summaryResponse?: () => Response;
  /** Series the evolution request answers with. */
  readonly evolution?: MonthlyEvolutionDto;
  /** Answers the evolution request with this response instead of a series. */
  readonly evolutionResponse?: () => Response;
}

/**
 * Fetch that serves the dashboard endpoints plus the movement maintenance ones.
 *
 * Only the browser boundary is replaced: the analytics client, the catalogs
 * loader and the mutation dialogs all run their real logic against it.
 */
export function dashboardFetch(
  options: DashboardFetchOptions = {},
): ReturnType<typeof vi.fn<FetchLike>> {
  const fallback = maintenanceFetch();
  const summaries = options.summaries ?? [summary];
  let call = 0;

  return vi.fn<FetchLike>((path, init) => {
    if (path.startsWith("/api/analytics/summary")) {
      if (options.summaryResponse) {
        return Promise.resolve(options.summaryResponse());
      }

      const index = Math.min(call, summaries.length - 1);
      call += 1;

      return Promise.resolve(jsonResponse(200, envelope(summaries[index])));
    }

    if (path.startsWith("/api/analytics/evolution")) {
      if (options.evolutionResponse) {
        return Promise.resolve(options.evolutionResponse());
      }

      return Promise.resolve(
        jsonResponse(200, envelope(options.evolution ?? evolution)),
      );
    }

    return fallback(path, init);
  });
}
