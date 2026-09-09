/**
 * Visual comparison of income against expense.
 *
 * The drawing carries no value of its own: the suite pins that it is hidden
 * from assistive technology, that its legend names both series next to their
 * colours, and that the section points at the table where the same figures are
 * available.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { dashboardCopy } from "../dashboard-copy";
import { summary, totals } from "../dashboard-fixtures";
import { IncomeExpenseComparison } from "./income-expense-comparison";

describe("IncomeExpenseComparison", () => {
  it("names both series so the colours are never the only difference", () => {
    render(
      <IncomeExpenseComparison
        comparison={summary.comparison}
        totals={totals}
      />,
    );

    const legend = screen.getByRole("list", {
      name: dashboardCopy.comparisonChartLabel,
    });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([dashboardCopy.income, dashboardCopy.expense]);
    expect(screen.getByText(dashboardCopy.chartAlternative)).toBeVisible();
  });

  it("loads the drawing lazily and keeps it out of the accessibility tree", async () => {
    const { container } = render(
      <IncomeExpenseComparison
        comparison={summary.comparison}
        totals={totals}
      />,
    );
    const figure = container.querySelector('[data-chart="income-expense"]');

    expect(figure).toHaveAttribute("aria-hidden", "true");
    expect(figure?.querySelector(".recharts-responsive-container")).toBeNull();

    await waitFor(() => {
      expect(
        figure?.querySelector(".recharts-responsive-container"),
      ).not.toBeNull();
    });
  });
});
