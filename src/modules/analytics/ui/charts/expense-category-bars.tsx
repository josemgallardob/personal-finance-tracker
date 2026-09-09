"use client";

/**
 * Expense by category of the selected period.
 *
 * The groups are disjoint and add up to the expense of the period, so every row
 * states its share of it. The breakdown follows the period of the cards, not
 * the window of the evolution series.
 */

import type { CategoryExpenseDto } from "../../contracts/summary";
import { dashboardCopy } from "../dashboard-copy";
import { BreakdownSection } from "./breakdown-section";
import { expenseCategoryBars } from "./chart-series";

/** Identifier of the heading that labels the category breakdown. */
export const CATEGORY_BARS_TITLE_ID = "dashboard-category-title";

export interface ExpenseCategoryBarsProps {
  readonly entries: readonly CategoryExpenseDto[];
  /** Expense of the period, the divisor every share is taken over. */
  readonly expenseMinor: number;
}

export function ExpenseCategoryBars({
  entries,
  expenseMinor,
}: ExpenseCategoryBarsProps) {
  return (
    <BreakdownSection
      bars={expenseCategoryBars(entries, expenseMinor)}
      caption={dashboardCopy.categoryCaption}
      chartName="expense-by-category"
      emptyDescription={dashboardCopy.categoryEmptyDescription}
      emptyTitle={dashboardCopy.categoryEmptyTitle}
      labelColumn={dashboardCopy.categoryColumn}
      showShare
      title={dashboardCopy.categoryTitle}
      titleId={CATEGORY_BARS_TITLE_ID}
    />
  );
}
