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
import type {
  ComparedPeriodTotalsDto,
  DashboardSummaryDto,
  DateRangeDto,
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
  expenseByCategory: [],
  expenseByTag: {
    tags: [],
    untagged: {
      totalMinor: 0,
      transactionCount: 0,
      drillDown: { ...drillDown("expense"), untagged: true },
    },
    overlapping: true,
  },
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

    return fallback(path, init);
  });
}
