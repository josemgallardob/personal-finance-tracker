/**
 * Expense by tag of the period.
 *
 * The suite pins the rule that separates this breakdown from the category one:
 * the groups overlap, the section says so, and no row states a percentage. It
 * also pins the computed untagged group, which appears only when the period has
 * expense without tags and is not one of the stored tags.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { TagExpenseBreakdownDto } from "../../contracts/summary";
import { dashboardCopy } from "../dashboard-copy";
import { expenseByTag } from "../dashboard-fixtures";
import { ExpenseTagBars } from "./expense-tag-bars";

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

function renderBars(breakdown: TagExpenseBreakdownDto = expenseByTag) {
  return render(<ExpenseTagBars breakdown={breakdown} />);
}

function table(): HTMLElement {
  return screen.getByRole("table", { name: dashboardCopy.tagCaption });
}

describe("ExpenseTagBars", () => {
  it("warns that the groups overlap and states no percentage", () => {
    renderBars();

    expect(screen.getByText(dashboardCopy.tagOverlap)).toBeVisible();
    expect(
      within(table()).queryByRole("columnheader", {
        name: dashboardCopy.shareColumn,
      }),
    ).not.toBeInTheDocument();

    const row = within(table())
      .getByRole("rowheader", { name: /Viajes/ })
      .closest("tr") as HTMLElement;
    expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => withPlainSpaces(cell.textContent)),
    ).toEqual(["800,00 €", "2 movimientos"]);
  });

  it("adds the computed untagged group with its amount and its own history", () => {
    renderBars();

    const row = within(table())
      .getByRole("rowheader", { name: dashboardCopy.untagged })
      .closest("tr") as HTMLElement;

    expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => withPlainSpaces(cell.textContent)),
    ).toEqual(["400,50 €", "1 movimiento"]);
    expect(
      within(row).getByRole("link", { name: dashboardCopy.untagged }),
    ).toHaveAttribute(
      "href",
      "/transactions?dateFrom=2026-09-01&dateTo=2026-09-08&type=expense&untagged=true&tab=all",
    );
  });

  it("keeps a group whose interval cannot be opened as plain text", () => {
    renderBars({
      ...expenseByTag,
      tags: [
        {
          ...expenseByTag.tags[0],
          drillDown: {
            ...expenseByTag.tags[0].drillDown,
            dateFrom: "2026-13-01",
          },
        },
      ],
    });

    const row = within(table())
      .getByRole("rowheader", { name: /Viajes/ })
      .closest("tr") as HTMLElement;

    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(within(row).getByText("Viajes")).toBeVisible();
  });

  it("omits the untagged group when every expense of the period is tagged", () => {
    renderBars({
      ...expenseByTag,
      untagged: {
        ...expenseByTag.untagged,
        totalMinor: 0,
        transactionCount: 0,
      },
    });

    expect(
      within(table()).queryByRole("rowheader", {
        name: dashboardCopy.untagged,
      }),
    ).not.toBeInTheDocument();
  });

  it("names an archived tag as archived and still draws its amount", () => {
    renderBars();

    expect(
      within(table()).getByRole("rowheader", {
        name: dashboardCopy.archivedOf("Vieja"),
      }),
    ).toBeVisible();
  });

  it("loads the drawing lazily and hides it from assistive technology", async () => {
    const { container } = renderBars();
    const figure = container.querySelector('[data-chart="expense-by-tag"]');

    expect(figure).toHaveAttribute("aria-hidden", "true");
    await waitFor(() => {
      expect(
        figure?.querySelector(".recharts-responsive-container"),
      ).not.toBeNull();
    });
  });

  it("explains a period without tagged expense instead of drawing a chart", () => {
    renderBars({
      tags: [],
      untagged: {
        ...expenseByTag.untagged,
        totalMinor: 0,
        transactionCount: 0,
      },
      overlapping: true,
    });

    expect(
      screen.getByRole("heading", { name: dashboardCopy.tagEmptyTitle }),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
