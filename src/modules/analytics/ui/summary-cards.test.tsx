/**
 * Income, expense and net cards.
 *
 * The suite pins the exact figures of the fixture period, the semantic colour
 * of each one, the neutral treatment of a balance of exactly zero, the change
 * of a period without comparison base, and the history link every card opens.
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { dashboardCopy } from "./dashboard-copy";
import { summary, totals } from "./dashboard-fixtures";
import { SummaryCards } from "./summary-cards";

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

function renderCards(overrides: Partial<typeof totals> = {}) {
  render(
    <SummaryCards
      drillDowns={summary.drillDowns}
      totals={{ ...totals, ...overrides }}
    />,
  );

  return screen.getByRole("list", { name: dashboardCopy.summaryLabel });
}

function card(list: HTMLElement, title: string): HTMLElement {
  const heading = within(list).getByRole("heading", { name: title });
  const item = heading.closest("li");

  if (item === null) {
    throw new Error(`The ${title} card is not a list item.`);
  }

  return item;
}

describe("SummaryCards", () => {
  it("shows the exact figures and counts of the period", () => {
    const list = renderCards();

    const income = card(list, dashboardCopy.income);
    expect(within(income).getByText("2500,00 €")).toBeVisible();
    expect(within(income).getByText("1 movimiento")).toBeVisible();
    expect(within(income).getByText("Variación: +25,00 %")).toBeVisible();

    const expense = card(list, dashboardCopy.expense);
    expect(within(expense).getByText("1200,50 €")).toBeVisible();
    expect(within(expense).getByText("3 movimientos")).toBeVisible();
    expect(within(expense).getByText("Variación: −19,97 %")).toBeVisible();

    const net = card(list, dashboardCopy.net);
    expect(within(net).getByText("+1299,50 €")).toBeVisible();
    expect(within(net).getByText("4 movimientos")).toBeVisible();
    expect(within(net).getByText(dashboardCopy.netHint)).toBeVisible();
  });

  it("colours income and expense semantically without dropping their names", () => {
    const list = renderCards();

    expect(
      within(card(list, dashboardCopy.income)).getByText("2500,00 €"),
    ).toHaveClass("text-income");
    expect(
      within(card(list, dashboardCopy.expense)).getByText("1200,50 €"),
    ).toHaveClass("text-expense");
  });

  it("marks a negative balance with its sign and its colour", () => {
    const list = renderCards({
      current: {
        incomeMinor: 100000,
        expenseMinor: 150000,
        netMinor: -50000,
        incomeCount: 1,
        expenseCount: 2,
      },
    });

    const net = within(card(list, dashboardCopy.net)).getByText("−500,00 €");
    expect(net).toBeVisible();
    expect(net).toHaveClass("text-expense");
  });

  it("keeps a balance of exactly zero neutral and unsigned", () => {
    const list = renderCards({
      current: {
        incomeMinor: 100000,
        expenseMinor: 100000,
        netMinor: 0,
        incomeCount: 1,
        expenseCount: 1,
      },
    });

    const net = within(card(list, dashboardCopy.net)).getByText("0,00 €");
    expect(net).toBeVisible();
    expect(net).toHaveClass("text-text");
  });

  it("says there is no comparison base instead of drawing a change of zero", () => {
    const list = renderCards({
      income: {
        currentMinor: 250000,
        previousMinor: 0,
        deltaMinor: 250000,
        deltaPercent: null,
        reason: "noComparisonBase",
      },
    });

    expect(
      within(card(list, dashboardCopy.income)).getByText(
        `Variación: ${dashboardCopy.noComparisonBase}`,
      ),
    ).toBeVisible();
  });

  it("opens the history on the filter that produced each figure", () => {
    const list = renderCards();

    expect(
      within(card(list, dashboardCopy.income)).getByRole("link", {
        name: dashboardCopy.viewIncome,
      }),
    ).toHaveAttribute(
      "href",
      "/transactions?dateFrom=2026-09-01&dateTo=2026-09-08&type=income&tab=all",
    );
    expect(
      within(card(list, dashboardCopy.net)).getByRole("link", {
        name: dashboardCopy.viewNet,
      }),
    ).toHaveAttribute(
      "href",
      "/transactions?dateFrom=2026-09-01&dateTo=2026-09-08&tab=all",
    );
  });

  it("omits the link of a figure whose interval is not a civil date", () => {
    render(
      <SummaryCards
        drillDowns={{
          ...summary.drillDowns,
          expense: { ...summary.drillDowns.expense, dateFrom: "2026-13-01" },
        }}
        totals={totals}
      />,
    );

    expect(
      screen.queryByRole("link", { name: dashboardCopy.viewExpense }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: dashboardCopy.viewIncome }),
    ).toBeVisible();
  });
});
