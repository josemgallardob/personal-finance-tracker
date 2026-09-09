"use client";

/**
 * Dashboard of the selected period.
 *
 * The period lives in this component and never in the URL: the history owns the
 * query string, so navigating to a filtered history and coming back leaves the
 * cards exactly on the period they were showing. Changing the period changes
 * the request identity, which aborts the in-flight call and discards a slower
 * answer that belonged to the previous selection.
 *
 * The view reloads on the shell revision, so a movement created, edited or
 * deleted from anywhere under the shell recomputes these figures without a
 * manual reload; a failed mutation never touches the revision and therefore
 * never repaints the cards.
 */

import { useMemo, useState } from "react";

import {
  createApiClient,
  type ApiClient,
  type ApiClientFailure,
} from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import {
  useResource,
  type ResourceSnapshot,
} from "../../../shared/client/use-resource";
import { Button } from "../../../shared/ui/button";
import { LoadingState } from "../../../shared/ui/loading-state";
import { apiFailureMessage } from "../../transactions/ui/transaction-dialog-support";
import { createAnalyticsApi } from "../client/analytics-api";
import type { MonthlyEvolutionDto } from "../contracts/evolution";
import type { DashboardPeriod } from "../domain/periods";
import { dashboardCopy } from "./dashboard-copy";
import {
  DEFAULT_DASHBOARD_PERIOD,
  dashboardPeriodRequestKey,
  toDashboardSummaryQuery,
} from "./dashboard-period";
import { loadDashboardSnapshot } from "./dashboard-load";
import { ExpenseCategoryBars } from "./charts/expense-category-bars";
import { ExpenseTagBars } from "./charts/expense-tag-bars";
import { MonthlyTrend } from "./charts/monthly-trend";
import { PeriodComparison } from "./period-comparison";
import { PeriodSelector } from "./period-selector";
import { RecentTransactions } from "./recent-transactions";
import { SummaryCards } from "./summary-cards";
import { formatDateRangeLabel } from "./summary-presentation";

/** Identity of the evolution request, deliberately free of the period. */
export const EVOLUTION_REQUEST_KEY = "analytics:evolution";

export interface DashboardSummaryProps {
  /**
   * Browser transport. The default talks to the current origin; tests inject
   * the same client over a replaced `fetch`.
   */
  readonly client?: ApiClient;
  /** Period the dashboard opens on. Production uses the accepted default. */
  readonly initialPeriod?: DashboardPeriod;
}

/** Cards, comparison and recent movements of the selected period. */
export function DashboardSummary({
  client,
  initialPeriod = DEFAULT_DASHBOARD_PERIOD,
}: DashboardSummaryProps = {}) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const [period, setPeriod] = useState<DashboardPeriod>(initialPeriod);
  const { revision, refreshEpoch } = useFinancialDataRevision();
  const snapshot = useResource({
    requestKey: dashboardPeriodRequestKey(period),
    revision,
    refreshEpoch,
    load: (signal) =>
      loadDashboardSnapshot(apiClient, signal, toDashboardSummaryQuery(period)),
  });
  const analyticsApi = useMemo(
    () => createAnalyticsApi(apiClient),
    [apiClient],
  );
  // The evolution keeps its own window, so its request identity ignores the
  // selected period: changing the cards never refetches or reshapes the series.
  const evolution = useResource({
    requestKey: EVOLUTION_REQUEST_KEY,
    revision,
    refreshEpoch,
    load: (signal) => analyticsApi.readEvolution({ signal }),
  });
  const data = snapshot.data;

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PeriodSelector onChange={setPeriod} value={period} />
      {snapshot.status === "loading" ? (
        <LoadingState label={dashboardCopy.loading} />
      ) : null}
      {snapshot.status === "error" ? (
        <div
          className="border-danger bg-surface-raised flex w-full max-w-full flex-col items-start gap-3 rounded-lg border p-4 sm:p-6"
          role="alert"
        >
          <p className="text-body text-text font-medium">
            {dashboardCopy.errorTitle}
          </p>
          <p className="text-body-sm text-text-muted max-w-xl">
            {snapshot.error
              ? apiFailureMessage(snapshot.error, dashboardCopy.errorHint)
              : dashboardCopy.errorHint}
          </p>
          <Button
            aria-label={dashboardCopy.retry}
            onClick={snapshot.refetch}
            variant="secondary"
          >
            {dashboardCopy.retry}
          </Button>
        </div>
      ) : null}
      {data === undefined ? null : (
        <>
          <p className="text-body-sm text-text-muted">
            {dashboardCopy.periodRange(
              formatDateRangeLabel(data.summary.range),
            )}
          </p>
          <SummaryCards
            drillDowns={data.summary.drillDowns}
            totals={data.summary.totals}
          />
          <PeriodComparison
            comparison={data.summary.comparison}
            totals={data.summary.totals}
          />
          <MonthlyTrendSection snapshot={evolution} />
          <ExpenseCategoryBars
            entries={data.summary.expenseByCategory}
            expenseMinor={data.summary.totals.current.expenseMinor}
          />
          <ExpenseTagBars breakdown={data.summary.expenseByTag} />
          <RecentTransactions
            categories={data.categories}
            client={apiClient}
            tags={data.tags}
            transactions={data.summary.recentTransactions}
          />
        </>
      )}
    </div>
  );
}

function MonthlyTrendSection({
  snapshot,
}: {
  readonly snapshot: ResourceSnapshot<MonthlyEvolutionDto>;
}) {
  if (snapshot.status === "loading") {
    return <LoadingState label={dashboardCopy.trendLoading} />;
  }

  if (snapshot.data === undefined) {
    return (
      <ChartLoadFailure
        error={snapshot.error}
        onRetry={snapshot.refetch}
        title={dashboardCopy.trendErrorTitle}
      />
    );
  }

  return <MonthlyTrend evolution={snapshot.data} />;
}

function ChartLoadFailure({
  error,
  onRetry,
  title,
}: {
  readonly error: ApiClientFailure | undefined;
  readonly onRetry: () => void;
  readonly title: string;
}) {
  return (
    <div
      className="border-danger bg-surface-raised flex w-full max-w-full flex-col items-start gap-3 rounded-lg border p-4 sm:p-6"
      role="alert"
    >
      <p className="text-body text-text font-medium">{title}</p>
      <p className="text-body-sm text-text-muted max-w-xl">
        {error
          ? apiFailureMessage(error, dashboardCopy.errorHint)
          : dashboardCopy.errorHint}
      </p>
      <Button
        aria-label={dashboardCopy.retry}
        onClick={onRetry}
        variant="secondary"
      >
        {dashboardCopy.retry}
      </Button>
    </div>
  );
}
