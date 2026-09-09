/**
 * Expense by category of the period.
 *
 * The suite pins that every bar is also a row with its exact amount, its
 * movement count and its share of the period expense, that an archived category
 * with an amount in the window is still drawn and named as archived, that a
 * long name is never shortened, and that an empty period explains itself
 * instead of drawing an empty chart.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { CategoryExpenseDto } from "../../contracts/summary";
import { dashboardCopy } from "../dashboard-copy";
import { expenseByCategory } from "../dashboard-fixtures";
import { ExpenseCategoryBars } from "./expense-category-bars";

vi.mock("next/link", () => ({
  default: function MockLink({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

/** Replaces the narrow no-break spaces produced by Intl with plain spaces. */
function withPlainSpaces(text: string | null): string {
  return (text ?? "").replace(/[\u202f\u00a0]/g, " ");
}

function renderBars(
  entries: readonly CategoryExpenseDto[] = expenseByCategory,
  expenseMinor = 120050,
) {
  return render(
    <ExpenseCategoryBars entries={entries} expenseMinor={expenseMinor} />,
  );
}

function table(): HTMLElement {
  return screen.getByRole("table", { name: dashboardCopy.categoryCaption });
}

describe("ExpenseCategoryBars", () => {
  it("publishes the amount, the movements and the share of every group", () => {
    renderBars();

    const row = within(table())
      .getByRole("rowheader", { name: /Alimentación/ })
      .closest("tr") as HTMLElement;

    expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => withPlainSpaces(cell.textContent)),
    ).toEqual(["900,00 €", "2 movimientos", "74,97 % del gasto"]);
  });

  it("keeps an archived category in the breakdown and names it as archived", () => {
    renderBars();

    expect(
      within(table()).getByRole("rowheader", {
        name: dashboardCopy.archivedOf("Antigua"),
      }),
    ).toBeVisible();
  });

  it("opens the history of the category from its own row", () => {
    renderBars();

    expect(screen.getByRole("link", { name: "Alimentación" })).toHaveAttribute(
      "href",
      "/transactions?dateFrom=2026-09-01&dateTo=2026-09-08&type=expense&categoryId=cat-food&tab=all",
    );
  });

  it("keeps a long category name whole in its row", () => {
    const name =
      "Suscripciones, planes de ocio y otros gastos recurrentes del hogar";
    renderBars([
      {
        ...expenseByCategory[0],
        category: { ...expenseByCategory[0].category, name },
      },
    ]);

    expect(
      within(table()).getByRole("rowheader", { name: new RegExp(name) }),
    ).toBeVisible();
  });

  it("leaves the share cell empty rather than claiming a group is 0 % of nothing", () => {
    renderBars([expenseByCategory[0]], 0);

    const row = within(table())
      .getByRole("rowheader", { name: /Alimentación/ })
      .closest("tr") as HTMLElement;

    expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => withPlainSpaces(cell.textContent)),
    ).toEqual(["900,00 €", "2 movimientos", ""]);
  });

  it("loads the drawing lazily and hides it from assistive technology", async () => {
    const { container } = renderBars();
    const figure = container.querySelector(
      '[data-chart="expense-by-category"]',
    );

    expect(figure).toHaveAttribute("aria-hidden", "true");
    await waitFor(() => {
      expect(
        figure?.querySelector(".recharts-responsive-container"),
      ).not.toBeNull();
    });
  });

  it("explains an empty period instead of drawing an empty chart", () => {
    const { container } = renderBars([], 0);

    expect(
      screen.getByRole("heading", { name: dashboardCopy.categoryEmptyTitle }),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-chart="expense-by-category"]'),
    ).toBeNull();
  });
});
