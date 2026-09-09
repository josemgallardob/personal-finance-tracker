/**
 * Comparison of the selected period with the equivalent previous one.
 *
 * The suite pins that both intervals are stated with their civil dates before
 * any percentage is read, and that the table gives every figure a name, a
 * current value, a previous value and its change.
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { dashboardCopy } from "./dashboard-copy";
import { summary, totals } from "./dashboard-fixtures";
import { PeriodComparison } from "./period-comparison";

function renderComparison(overrides: Partial<typeof totals> = {}): HTMLElement {
  render(
    <PeriodComparison
      comparison={summary.comparison}
      totals={{ ...totals, ...overrides }}
    />,
  );

  return screen.getByRole("table", { name: dashboardCopy.comparisonTitle });
}

/** Replaces the narrow no-break spaces produced by Intl with plain spaces. */
function withPlainSpaces(text: string | null): string {
  return (text ?? "").replace(/[\u202f\u00a0]/g, " ");
}

function row(table: HTMLElement, concept: string): HTMLElement {
  return within(table).getByRole("rowheader", { name: concept }).closest("tr")!;
}

describe("PeriodComparison", () => {
  it("states both intervals so a partial period cannot be misread", () => {
    renderComparison();

    expect(
      screen.getByText(
        "01/09/2026 – 08/09/2026 frente a 01/08/2026 – 08/08/2026",
      ),
    ).toBeVisible();
  });

  it("gives each figure its current value, its previous one and its change", () => {
    const table = renderComparison();

    const income = within(row(table, dashboardCopy.income)).getAllByRole(
      "cell",
    );
    expect(income.map((cell) => withPlainSpaces(cell.textContent))).toEqual([
      "2500,00 €",
      "2000,00 €",
      "+25,00 %",
    ]);

    const net = within(row(table, dashboardCopy.net)).getAllByRole("cell");
    expect(net.map((cell) => withPlainSpaces(cell.textContent))).toEqual([
      "+1299,50 €",
      "+500,00 €",
      "+159,90 %",
    ]);
  });

  it("reports a change without base instead of a percentage", () => {
    const table = renderComparison({
      expense: {
        currentMinor: 120050,
        previousMinor: 0,
        deltaMinor: 120050,
        deltaPercent: null,
        reason: "noComparisonBase",
      },
    });

    expect(
      within(row(table, dashboardCopy.expense)).getByText(
        dashboardCopy.noComparisonBase,
      ),
    ).toBeVisible();
  });
});
