"use client";

/**
 * Dashboard of the selected period.
 *
 * The period lives in the session and never in the URL: the history owns the
 * query string, so a filter applied there cannot move the months of the cards,
 * while leaving the dashboard to read the movements behind a figure and coming
 * back returns to the period that was being read. Changing the period changes
 * the request identity, which aborts the in-flight call and discards a slower
 * answer that belonged to the previous selection.
 *
 * The view reloads on the shell revision, so a movement created, edited or
 * deleted from anywhere under the shell recomputes these figures without a
 * manual reload; a failed mutation never touches the revision and therefore
 * never repaints the cards.
 *
 * The three reads fail independently and say so where they belong. The period
 * of the cards, the evolution window and the averages window are separate
 * questions, so a refused one explains itself and offers its own retry while
 * the other two keep showing the figures they did receive.
 */

import { useMemo } from "react";

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
import { createPreferencesApi } from "../../preferences/client/preferences-api";
import { createAnalyticsApi } from "../client/analytics-api";
import type { MonthlyAveragesDto } from "../contracts/averages";
import type { MonthlyEvolutionDto } from "../contracts/evolution";
import type { DashboardPeriod } from "../domain/periods";
import { dashboardCopy } from "./dashboard-copy";
import {
  DEFAULT_DASHBOARD_PERIOD,
  dashboardPeriodRequestKey,
  toDashboardSummaryQuery,
} from "./dashboard-period";
import { loadDashboardSnapshot } from "./dashboard-load";
import { useDashboardPeriod } from "./dashboard-period-store";
import { MonthlyAverages } from "./averages/monthly-averages";
import { ExpenseCategoryBars } from "./charts/expense-category-bars";
import { ExpenseTagBars } from "./charts/expense-tag-bars";
import { MonthlyTrend } from "./charts/monthly-trend";
import {
  categorySeriesOptions,
  idsWithAmount,
  tagSeriesOptions,
} from "./series/series-options";
import { useSeriesSelection } from "./series/use-series-selection";
import type { SeriesStorage } from "./series/series-selection";
import type { SeriesSelection } from "./series/use-series-selection";
import type { MultiSelectOption } from "../../../shared/ui/multi-select";
import { PeriodComparison } from "./period-comparison";
import { PeriodSelector } from "./period-selector";
import { RecentTransactions } from "./recent-transactions";
import { SummaryCards } from "./summary-cards";
import { formatDateRangeLabel } from "./summary-presentation";

/** Identity of the evolution request, deliberately free of the period. */
export const EVOLUTION_REQUEST_KEY = "analytics:evolution";

/** Identity of the averages request, also free of the selected period. */
export const AVERAGES_REQUEST_KEY = "analytics:averages";

export interface DashboardSummaryProps {
  /**
   * Browser transport. The default talks to the current origin; tests inject
   * the same client over a replaced `fetch`.
   */
  readonly client?: ApiClient;
  /** Period the dashboard opens on. Production uses the accepted default. */
  readonly initialPeriod?: DashboardPeriod;
  /**
   * Session storage of the period and of the series selection. Tests replace
   * this boundary.
   */
  readonly seriesStorage?: SeriesStorage | null;
}

/** Cards, comparison and recent movements of the selected period. */
export function DashboardSummary({
  client,
  initialPeriod = DEFAULT_DASHBOARD_PERIOD,
  seriesStorage,
}: DashboardSummaryProps = {}) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const { revision, refreshEpoch } = useFinancialDataRevision();
  const preferences = useResource({
    requestKey: "preferences:dashboard-mode",
    revision,
    refreshEpoch,
    load: (signal) =>
      createPreferencesApi(apiClient).getPreferences({ signal }),
  });
  const { period, setPeriod } = useDashboardPeriod({
    initialPeriod,
    mode: preferences.data?.mode ?? null,
    storage: seriesStorage,
  });
  const snapshot = useResource({
    requestKey: dashboardPeriodRequestKey(period),
    revision,
    refreshEpoch,
    enabled: preferences.data !== undefined,
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
  // The averages divide by their own window of closed months, so their request
  // identity ignores the period selector just as the evolution one does.
  const averages = useResource({
    requestKey: AVERAGES_REQUEST_KEY,
    revision,
    refreshEpoch,
    load: (signal) => analyticsApi.readAverages({ signal }),
  });
  const data = snapshot.data;
  const averagesData = averages.data;
  const categoryOptions = useMemo(
    () =>
      categorySeriesOptions(
        data?.categories ?? [],
        idsWithAmount(
          (data?.summary.expenseByCategory ?? []).map((entry) => ({
            id: entry.category.id,
            totalMinor: entry.totalMinor,
          })),
          averagesData?.kind === "months"
            ? averagesData.byCategory.map((entry) => ({
                id: entry.category.id,
                totalMinor: entry.totalMinor,
              }))
            : [],
        ),
      ),
    [averagesData, data],
  );
  const tagOptions = useMemo(
    () =>
      tagSeriesOptions(
        data?.tags ?? [],
        idsWithAmount(
          (data?.summary.expenseByTag.tags ?? []).map((entry) => ({
            id: entry.tag.id,
            totalMinor: entry.totalMinor,
          })),
          averagesData?.kind === "months"
            ? averagesData.byTag.map((entry) => ({
                id: entry.tag.id,
                totalMinor: entry.totalMinor,
              }))
            : [],
        ),
        (data?.summary.expenseByTag.untagged.totalMinor ?? 0) !== 0 ||
          (averagesData?.kind === "months" &&
            averagesData.untagged.totalMinor !== 0),
      ),
    [averagesData, data],
  );
  const mode = data?.preferences.mode ?? null;
  const categorySelection = useSeriesSelection({
    dimension: "categories",
    mode,
    options: categoryOptions,
    storage: seriesStorage,
  });
  const tagSelection = useSeriesSelection({
    dimension: "tags",
    mode,
    options: tagOptions,
    storage: seriesStorage,
  });

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
          <p className="text-body-sm text-text-muted" data-period-range="">
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
          <ExpenseCategoryBars
            entries={data.summary.expenseByCategory}
            expenseMinor={data.summary.totals.current.expenseMinor}
            options={categoryOptions}
            selection={categorySelection}
          />
          <ExpenseTagBars
            breakdown={data.summary.expenseByTag}
            options={tagOptions}
            selection={tagSelection}
          />
          <RecentTransactions
            categories={data.categories}
            client={apiClient}
            tags={data.tags}
            transactions={data.summary.recentTransactions}
          />
        </>
      )}
      {/* The series and the averages answer windows of their own, so they are
          drawn even when the period of the cards could not be read. */}
      <MonthlyTrendSection snapshot={evolution} />
      <MonthlyAveragesSection
        categoryOptions={categoryOptions}
        categorySelection={categorySelection}
        snapshot={averages}
        tagOptions={tagOptions}
        tagSelection={tagSelection}
      />
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

function MonthlyAveragesSection({
  categoryOptions,
  categorySelection,
  snapshot,
  tagOptions,
  tagSelection,
}: {
  readonly categoryOptions: readonly MultiSelectOption[];
  readonly categorySelection: SeriesSelection;
  readonly snapshot: ResourceSnapshot<MonthlyAveragesDto>;
  readonly tagOptions: readonly MultiSelectOption[];
  readonly tagSelection: SeriesSelection;
}) {
  if (snapshot.status === "loading") {
    return <LoadingState label={dashboardCopy.averagesLoading} />;
  }

  if (snapshot.data === undefined) {
    return (
      <ChartLoadFailure
        error={snapshot.error}
        onRetry={snapshot.refetch}
        title={dashboardCopy.averagesErrorTitle}
      />
    );
  }

  return (
    <MonthlyAverages
      averages={snapshot.data}
      categoryOptions={categoryOptions}
      categorySelection={categorySelection}
      tagOptions={tagOptions}
      tagSelection={tagSelection}
    />
  );
}
