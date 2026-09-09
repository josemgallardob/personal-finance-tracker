/**
 * Monthly evolution section.
 *
 * The suite pins that the series states its own window and its independence
 * from the period selector, that every figure of the chart is also a row of a
 * table with its history link, that a month without movements is a zero and not
 * a hole, and that a workspace without movements shows an empty state instead
 * of a drawing.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { dashboardCopy } from "../dashboard-copy";
import { evolution } from "../dashboard-fixtures";
import { MonthlyTrend } from "./monthly-trend";

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

/** Window used only where a variant has to supply one it never reads. */
const NO_WINDOW = {
  start: "2026-07",
  end: "2026-09",
  months: ["2026-07", "2026-08", "2026-09"],
  monthCount: 3,
  range: { start: "2026-07-01", end: "2026-09-30" },
};

describe("MonthlyTrend", () => {
  it("states the window of the series and that the period does not change it", () => {
    render(<MonthlyTrend evolution={evolution} />);

    expect(screen.getByText("07/2026–09/2026 · 3 meses")).toBeVisible();
    expect(screen.getByText(dashboardCopy.trendIndependent)).toBeVisible();
  });

  it("publishes every month of the series as a row with both figures", () => {
    render(<MonthlyTrend evolution={evolution} />);

    const table = screen.getByRole("table", {
      name: dashboardCopy.trendCaption,
    });
    const august = within(table)
      .getByRole("rowheader", { name: "08/2026" })
      .closest("tr");

    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(
      within(august as HTMLElement)
        .getAllByRole("cell")
        .map((cell) => withPlainSpaces(cell.textContent)),
    ).toEqual(["0,00 €", "0,00 €"]);
  });

  it("opens the history of the month from its own row", () => {
    render(<MonthlyTrend evolution={evolution} />);

    expect(screen.getByRole("link", { name: "07/2026" })).toHaveAttribute(
      "href",
      "/transactions?dateFrom=2026-07-01&dateTo=2026-07-31&tab=all",
    );
  });

  it("keeps a month whose interval is unusable as plain text, not as a link", () => {
    const [july, ...rest] = evolution.kind === "months" ? evolution.months : [];

    render(
      <MonthlyTrend
        evolution={{
          kind: "months",
          window: evolution.kind === "months" ? evolution.window : NO_WINDOW,
          months: [
            {
              ...july,
              drillDown: { ...july.drillDown, dateFrom: "2026-13-01" },
            },
            ...rest,
          ],
        }}
      />,
    );

    expect(
      screen.queryByRole("link", { name: "07/2026" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "07/2026" })).toBeVisible();
  });

  it("loads the drawing only after the section is rendered", async () => {
    const { container } = render(<MonthlyTrend evolution={evolution} />);
    const figure = container.querySelector('[data-chart="monthly-trend"]');

    expect(figure).not.toBeNull();
    expect(figure).toHaveAttribute("aria-hidden", "true");
    expect(figure?.querySelector(".recharts-responsive-container")).toBeNull();

    await waitFor(() => {
      expect(
        figure?.querySelector(".recharts-responsive-container"),
      ).not.toBeNull();
    });
  });

  it("shows an empty state, and no drawing, when there is no movement at all", () => {
    const { container } = render(
      <MonthlyTrend evolution={{ kind: "empty" }} />,
    );

    expect(
      screen.getByRole("heading", { name: dashboardCopy.trendEmptyTitle }),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(container.querySelector('[data-chart="monthly-trend"]')).toBeNull();
  });
});
