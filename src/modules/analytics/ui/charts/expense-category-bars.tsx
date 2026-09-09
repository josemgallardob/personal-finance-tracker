"use client";

/**
 * Expense by category of the selected period.
 *
 * The groups are disjoint and add up to the expense of the period, so every row
 * states its share of it. The breakdown follows the period of the cards, not
 * the window of the evolution series.
 */

import type { MultiSelectOption } from "../../../../shared/ui/multi-select";
import type { CategoryExpenseDto } from "../../contracts/summary";
import { dashboardCopy } from "../dashboard-copy";
import { selectedSeries } from "../series/series-selection";
import { CategorySeriesSelector } from "../series/series-selectors";
import type { SeriesSelection } from "../series/use-series-selection";
import { BreakdownSection } from "./breakdown-section";
import { expenseCategoryBars } from "./chart-series";

/** Identifier of the heading that labels the category breakdown. */
export const CATEGORY_BARS_TITLE_ID = "dashboard-category-title";

export interface ExpenseCategoryBarsProps {
  readonly entries: readonly CategoryExpenseDto[];
  /** Expense of the period, the divisor every share is taken over. */
  readonly expenseMinor: number;
  /** Options of the shared selector. Omitted when there is no selector. */
  readonly options?: readonly MultiSelectOption[];
  /** Selection shared with the monthly average of the same dimension. */
  readonly selection?: SeriesSelection;
}

export function ExpenseCategoryBars({
  entries,
  expenseMinor,
  options,
  selection,
}: ExpenseCategoryBarsProps) {
  const bars = expenseCategoryBars(entries, expenseMinor);

  return (
    <BreakdownSection
      bars={selection ? selectedSeries(bars, selection.ids) : bars}
      caption={dashboardCopy.categoryCaption}
      chartName="expense-by-category"
      emptyDescription={dashboardCopy.categoryEmptyDescription}
      emptyTitle={dashboardCopy.categoryEmptyTitle}
      labelColumn={dashboardCopy.categoryColumn}
      onSelectAll={selection?.selectAll}
      selectionEmpty={bars.length > 0}
      selector={
        selection && options ? (
          <CategorySeriesSelector
            onChange={selection.setIds}
            options={options}
            value={selection.ids}
          />
        ) : undefined
      }
      showShare
      title={dashboardCopy.categoryTitle}
      titleId={CATEGORY_BARS_TITLE_ID}
    />
  );
}
