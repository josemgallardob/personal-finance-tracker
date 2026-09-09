"use client";

/**
 * Expense by tag of the selected period, plus the computed untagged group.
 *
 * The groups overlap: a movement with several tags counts its whole amount in
 * each of them, so their sum is not the expense of the period and no row states
 * a percentage. The section says so above the figures instead of leaving the
 * reader to infer it.
 *
 * "Sin etiquetas" is not a stored tag but a computed group of expense without
 * any tag. It appears only when the period really contains that expense.
 */

import type { TagExpenseBreakdownDto } from "../../contracts/summary";
import { dashboardCopy } from "../dashboard-copy";
import { BreakdownSection } from "./breakdown-section";
import { expenseTagBars } from "./chart-series";

/** Identifier of the heading that labels the tag breakdown. */
export const TAG_BARS_TITLE_ID = "dashboard-tag-title";

export interface ExpenseTagBarsProps {
  readonly breakdown: TagExpenseBreakdownDto;
}

export function ExpenseTagBars({ breakdown }: ExpenseTagBarsProps) {
  return (
    <BreakdownSection
      bars={expenseTagBars(breakdown)}
      caption={dashboardCopy.tagCaption}
      chartName="expense-by-tag"
      emptyDescription={dashboardCopy.tagEmptyDescription}
      emptyTitle={dashboardCopy.tagEmptyTitle}
      labelColumn={dashboardCopy.tagColumn}
      note={dashboardCopy.tagOverlap}
      showShare={false}
      title={dashboardCopy.tagTitle}
      titleId={TAG_BARS_TITLE_ID}
    />
  );
}
