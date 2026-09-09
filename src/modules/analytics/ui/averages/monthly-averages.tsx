"use client";

/**
 * Monthly averages of the workspace.
 *
 * The block answers a window of its own: at most the twelve natural months
 * closed before the current one, starting no earlier than the first month fully
 * after the first movement, months without movements included in the divisor
 * and the current month never included, because it is still running. The window
 * and its divisor are stated next to the figures, so an average is never read
 * as belonging to the period selected on the cards.
 *
 * When no month has closed since the first movement there is no divisor at all,
 * which is not the same as a window of zeroes: the block says so instead of
 * painting averages of zero.
 */

import Link from "next/link";

import { EmptyState, emptyStateCopy } from "../../../../shared/ui/empty-state";
import { cx } from "../../../../shared/ui/class-names";
import type { MonthlyAveragesDto } from "../../contracts/averages";
import type { DrillDownDto } from "../../contracts/drill-down";
import type { MultiSelectOption } from "../../../../shared/ui/multi-select";
import { BreakdownSection } from "../charts/breakdown-section";
import { dashboardCopy } from "../dashboard-copy";
import {
  drillDownHistoryHref,
  netTone,
  summaryToneClassName,
} from "../summary-presentation";
import { selectedSeries } from "../series/series-selection";
import type { SeriesSelection } from "../series/use-series-selection";
import {
  CategorySeriesSelector,
  TagSeriesSelector,
} from "../series/series-selectors";
import {
  averageAmountLabel,
  averagesWindowLabel,
  categoryAverageBars,
  presentedAverageMinor,
  signedAverageAmountLabel,
  tagAverageBars,
} from "./averages-series";

/** Identifier of the heading that labels the averages block. */
export const AVERAGES_TITLE_ID = "dashboard-averages-title";

/** Identifier of the heading of the averaged category breakdown. */
export const AVERAGE_CATEGORY_TITLE_ID = "dashboard-average-category-title";

/** Identifier of the heading of the averaged tag breakdown. */
export const AVERAGE_TAG_TITLE_ID = "dashboard-average-tag-title";

export interface MonthlyAveragesProps {
  readonly averages: MonthlyAveragesDto;
  readonly categoryOptions: readonly MultiSelectOption[];
  readonly categorySelection: SeriesSelection;
  readonly tagOptions: readonly MultiSelectOption[];
  readonly tagSelection: SeriesSelection;
}

export function MonthlyAverages({
  averages,
  categoryOptions,
  categorySelection,
  tagOptions,
  tagSelection,
}: MonthlyAveragesProps) {
  return (
    <section
      aria-labelledby={AVERAGES_TITLE_ID}
      className="flex w-full max-w-full min-w-0 flex-col gap-4"
    >
      <div className="flex w-full max-w-full min-w-0 flex-col gap-1">
        <h2
          className="text-heading-sm text-text font-medium"
          id={AVERAGES_TITLE_ID}
        >
          {dashboardCopy.averagesTitle}
        </h2>
        {averages.kind === "months" ? (
          <p className="text-body-sm text-text">
            {averagesWindowLabel(averages.context.window)}
          </p>
        ) : null}
        <p className="text-body-sm text-text-muted max-w-2xl">
          {dashboardCopy.averagesExcludesCurrentMonth}
        </p>
      </div>
      {averages.kind === "insufficientHistory" ? (
        <EmptyState
          description={emptyStateCopy.insufficientHistory.description}
          title={emptyStateCopy.insufficientHistory.title}
        />
      ) : (
        <>
          <ul
            aria-label={dashboardCopy.averagesCaption}
            className="grid w-full max-w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <AverageCard
              amount={averageAmountLabel(averages.totalExpense)}
              href={averages.totalExpense.drillDown}
              title={dashboardCopy.averageExpense}
              tone="expense"
            />
            <AverageCard
              amount={signedAverageAmountLabel(averages.net)}
              href={averages.net.drillDown}
              title={dashboardCopy.averageNet}
              tone={netTone(presentedAverageMinor(averages.net) ?? 0)}
            />
          </ul>
          <BreakdownSection
            bars={selectedSeries(
              categoryAverageBars(averages.byCategory),
              categorySelection.ids,
            )}
            caption={dashboardCopy.averageCategoryCaption}
            chartName="average-by-category"
            emptyDescription={dashboardCopy.averageCategoryEmptyDescription}
            emptyTitle={dashboardCopy.averageCategoryEmptyTitle}
            labelColumn={dashboardCopy.categoryColumn}
            onSelectAll={categorySelection.selectAll}
            selectionEmpty={categoryAverageBars(averages.byCategory).length > 0}
            selector={
              <CategorySeriesSelector
                onChange={categorySelection.setIds}
                options={categoryOptions}
                value={categorySelection.ids}
              />
            }
            showShare={false}
            title={dashboardCopy.averageCategoryTitle}
            titleId={AVERAGE_CATEGORY_TITLE_ID}
            titleLevel={3}
          />
          <BreakdownSection
            bars={selectedSeries(
              tagAverageBars(averages.byTag, averages.untagged),
              tagSelection.ids,
            )}
            caption={dashboardCopy.averageTagCaption}
            chartName="average-by-tag"
            emptyDescription={dashboardCopy.averageTagEmptyDescription}
            emptyTitle={dashboardCopy.averageTagEmptyTitle}
            labelColumn={dashboardCopy.tagColumn}
            note={dashboardCopy.tagOverlap}
            onSelectAll={tagSelection.selectAll}
            selectionEmpty={
              tagAverageBars(averages.byTag, averages.untagged).length > 0
            }
            selector={
              <TagSeriesSelector
                onChange={tagSelection.setIds}
                options={tagOptions}
                value={tagSelection.ids}
              />
            }
            showShare={false}
            title={dashboardCopy.averageTagTitle}
            titleId={AVERAGE_TAG_TITLE_ID}
            titleLevel={3}
          />
        </>
      )}
    </section>
  );
}

function AverageCard({
  amount,
  href,
  title,
  tone,
}: {
  readonly amount: string;
  readonly href: DrillDownDto;
  readonly title: string;
  readonly tone: Parameters<typeof summaryToneClassName>[0];
}) {
  const target = drillDownHistoryHref(href);

  return (
    <li className="border-border bg-surface-raised flex w-full max-w-full min-w-0 flex-col gap-2 rounded-[20px] border p-4 sm:p-6">
      <h3 className="text-body-sm text-text-muted font-semibold">{title}</h3>
      <p
        className={cx(
          "text-heading font-medium tabular-nums",
          summaryToneClassName(tone),
        )}
      >
        {amount}
      </p>
      <p className="text-caption text-text-muted">
        {dashboardCopy.averageColumn}
      </p>
      {target === null ? null : (
        <Link
          className="text-body-sm text-text focus-visible:outline-primary-bright mt-auto inline-flex min-h-11 items-center font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2"
          href={target}
        >
          {dashboardCopy.viewWindowMovements}
        </Link>
      )}
    </li>
  );
}
