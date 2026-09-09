/**
 * Dashboard summary against the real browser adapters.
 *
 * Only `fetch` is replaced: the analytics client, the catalogs loader, the
 * resource lifecycle and the mutation dialogs all run their own logic. The
 * suite pins the request each period produces, the loading, error and retry
 * states, the recalculation after a successful mutation, and that the selected
 * period survives that recalculation instead of returning to the default.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { API_ERROR_MESSAGE } from "../../../shared/contracts/api";
import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { FinancialDataProvider } from "../../../shared/client/financial-data-provider";
import { historyCopy } from "../../transactions/ui/history-copy";
import { transactionMaintenanceCopy } from "../../transactions/ui/transaction-dialog-support";
import { dashboardCopy } from "./dashboard-copy";
import {
  dashboardFetch,
  summary,
  summaryWith,
  totals,
} from "./dashboard-fixtures";
import { DashboardSummary } from "./dashboard-summary";

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

const REQUEST_ID = "req-dashboard-view";

/** Summary of a period whose income grew, used to observe a recalculation. */
const recalculatedSummary = summaryWith({
  totals: {
    ...totals,
    current: { ...totals.current, incomeMinor: 300000 },
  },
});

function renderDashboard(fetchImpl: FetchLike) {
  render(
    <FinancialDataProvider>
      <DashboardSummary client={createApiClient({ fetch: fetchImpl })} />
    </FinancialDataProvider>,
  );
}

function evolutionCalls(
  fetchImpl: ReturnType<typeof vi.fn<FetchLike>>,
): string[] {
  return fetchImpl.mock.calls
    .map(([path]) => path)
    .filter((path) => path.startsWith("/api/analytics/evolution"));
}

function summaryCalls(
  fetchImpl: ReturnType<typeof vi.fn<FetchLike>>,
): string[] {
  return fetchImpl.mock.calls
    .map(([path]) => path)
    .filter((path) => path.startsWith("/api/analytics/summary"));
}

async function waitForIncome(amount: string): Promise<void> {
  await waitFor(() => {
    const cards = screen.getByRole("list", {
      name: dashboardCopy.summaryLabel,
    });
    expect(within(cards).getByText(amount)).toBeVisible();
  });
}

describe("DashboardSummary period", () => {
  it("opens on the current month and shows its figures", async () => {
    const fetchImpl = dashboardFetch();

    renderDashboard(fetchImpl);

    expect(screen.getByText(dashboardCopy.loading)).toBeVisible();
    await waitForIncome("2500,00 €");

    expect(summaryCalls(fetchImpl)).toEqual([
      "/api/analytics/summary?period=currentMonth",
    ]);
    expect(
      screen.getByText(dashboardCopy.periodRange("01/09/2026 – 08/09/2026")),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: dashboardCopy.currentMonth }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("requests the preset the owner selects", async () => {
    const fetchImpl = dashboardFetch({
      summaries: [summary, recalculatedSummary],
    });

    renderDashboard(fetchImpl);
    await waitForIncome("2500,00 €");

    await userEvent.click(
      screen.getByRole("button", { name: dashboardCopy.lastThreeMonths }),
    );

    await waitForIncome("3000,00 €");
    expect(summaryCalls(fetchImpl)).toEqual([
      "/api/analytics/summary?period=currentMonth",
      "/api/analytics/summary?period=lastThreeMonths",
    ]);
  });

  it("requests a custom range with both natural months", async () => {
    const fetchImpl = dashboardFetch();

    renderDashboard(fetchImpl);
    await waitForIncome("2500,00 €");

    await userEvent.click(
      screen.getByRole("button", {
        name: new RegExp(dashboardCopy.customMonthRange),
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: dashboardCopy.monthRangeTitle,
    });
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: dashboardCopy.monthRangeApply,
      }),
    );

    expect(screen.getAllByText(dashboardCopy.monthRequired)).toHaveLength(2);
    expect(summaryCalls(fetchImpl)).toHaveLength(1);
  });

  it("shows the movements the summary reports as recent", async () => {
    renderDashboard(dashboardFetch());

    await waitForIncome("2500,00 €");

    const recent = screen.getByRole("list", {
      name: dashboardCopy.recentCaption,
    });
    expect(recent.children).toHaveLength(2);
    expect(within(recent).getByText("Supermercado")).toBeVisible();
  });
});

describe("DashboardSummary states", () => {
  it("explains a refused period and recovers when the owner retries", async () => {
    let refused = true;
    const fetchImpl = vi.fn<FetchLike>((path, init) => {
      if (path.startsWith("/api/analytics/summary") && refused) {
        refused = false;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "serviceUnavailable",
                message: API_ERROR_MESSAGE.serviceUnavailable,
                requestId: REQUEST_ID,
              },
            }),
            {
              status: 503,
              headers: {
                "content-type": "application/json; charset=utf-8",
                [REQUEST_ID_HEADER]: REQUEST_ID,
              },
            },
          ),
        );
      }

      return dashboardFetch()(path, init);
    });

    renderDashboard(fetchImpl);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        dashboardCopy.errorTitle,
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      API_ERROR_MESSAGE.serviceUnavailable,
    );

    await userEvent.click(
      screen.getByRole("button", { name: dashboardCopy.retry }),
    );

    await waitForIncome("2500,00 €");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("recalculates the cards after a movement is deleted, keeping the period", async () => {
    const fetchImpl = dashboardFetch({
      summaries: [summary, summary, recalculatedSummary],
    });

    renderDashboard(fetchImpl);
    await waitForIncome("2500,00 €");

    await userEvent.click(
      screen.getByRole("button", { name: dashboardCopy.previousMonth }),
    );
    await waitForIncome("2500,00 €");

    await userEvent.click(
      screen.getByRole("button", {
        name: historyCopy.actionsOf("Supermercado"),
      }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: historyCopy.deleteAction }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.deleteTitle,
    });
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: transactionMaintenanceCopy.deleteConfirm,
      }),
    );

    await waitForIncome("3000,00 €");
    expect(summaryCalls(fetchImpl)).toEqual([
      "/api/analytics/summary?period=currentMonth",
      "/api/analytics/summary?period=previousMonth",
      "/api/analytics/summary?period=previousMonth",
    ]);
    expect(
      screen.getByRole("button", { name: dashboardCopy.previousMonth }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("DashboardSummary evolution", () => {
  it("keeps the evolution window when the period of the cards changes", async () => {
    const fetchImpl = dashboardFetch({
      summaries: [summary, recalculatedSummary],
    });

    renderDashboard(fetchImpl);
    await waitForIncome("2500,00 €");
    expect(screen.getByText("07/2026–09/2026 · 3 meses")).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: dashboardCopy.currentYear }),
    );
    await waitForIncome("3000,00 €");

    expect(summaryCalls(fetchImpl)).toHaveLength(2);
    expect(evolutionCalls(fetchImpl)).toEqual(["/api/analytics/evolution"]);
    expect(screen.getByText("07/2026–09/2026 · 3 meses")).toBeVisible();
  });

  it("explains a failed series without hiding the figures of the period", async () => {
    let refused = true;
    const fetchImpl = vi.fn<FetchLike>((path, init) => {
      if (path.startsWith("/api/analytics/evolution") && refused) {
        refused = false;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "serviceUnavailable",
                message: API_ERROR_MESSAGE.serviceUnavailable,
                requestId: REQUEST_ID,
              },
            }),
            {
              status: 503,
              headers: {
                "content-type": "application/json; charset=utf-8",
                [REQUEST_ID_HEADER]: REQUEST_ID,
              },
            },
          ),
        );
      }

      return dashboardFetch()(path, init);
    });

    renderDashboard(fetchImpl);
    await waitForIncome("2500,00 €");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(dashboardCopy.trendErrorTitle);

    await userEvent.click(
      within(alert).getByRole("button", { name: dashboardCopy.retry }),
    );

    await waitFor(() => {
      expect(screen.getByText("07/2026–09/2026 · 3 meses")).toBeVisible();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a series answered without any representation as a failure", async () => {
    renderDashboard(
      dashboardFetch({
        evolutionResponse: () =>
          new Response(null, {
            status: 204,
            headers: { [REQUEST_ID_HEADER]: REQUEST_ID },
          }),
      }),
    );

    await waitForIncome("2500,00 €");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(dashboardCopy.trendErrorTitle);
    expect(alert).toHaveTextContent(dashboardCopy.errorHint);
  });

  it("shows both breakdowns of the period next to the cards", async () => {
    renderDashboard(dashboardFetch());
    await waitForIncome("2500,00 €");

    expect(
      screen.getByRole("table", { name: dashboardCopy.categoryCaption }),
    ).toBeVisible();
    expect(
      screen.getByRole("table", { name: dashboardCopy.tagCaption }),
    ).toBeVisible();
    expect(screen.getByText(dashboardCopy.tagOverlap)).toBeVisible();
  });
});
