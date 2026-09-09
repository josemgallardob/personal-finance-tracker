/**
 * Home route.
 *
 * The page is checked with the browser `fetch` replaced and nothing else, so
 * the assertion is that the route really wires the default adapter to the
 * documented analytics and classification endpoints of the current origin.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { FinancialDataProvider } from "../shared/client/financial-data-provider";
import { dashboardCopy } from "../modules/analytics/ui/dashboard-copy";
import { dashboardFetch } from "../modules/analytics/ui/dashboard-fixtures";
import HomePage from "./page";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HomePage", () => {
  it("presents the summary of the current month returned by the API", async () => {
    const fetchImpl = dashboardFetch();
    vi.stubGlobal("fetch", fetchImpl);

    render(
      <FinancialDataProvider>
        <HomePage />
      </FinancialDataProvider>,
    );

    expect(
      screen.getByRole("heading", { name: dashboardCopy.title, level: 1 }),
    ).toBeVisible();

    const cards = await screen.findByRole("list", {
      name: dashboardCopy.summaryLabel,
    });
    await waitFor(() => {
      expect(within(cards).getByText("2500,00 €")).toBeVisible();
    });

    expect(within(cards).getByText("1200,50 €")).toBeVisible();
    expect(within(cards).getByText("+1299,50 €")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: dashboardCopy.comparisonTitle }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: dashboardCopy.recentTitle }),
    ).toBeVisible();
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/analytics/summary?period=currentMonth",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });
});
