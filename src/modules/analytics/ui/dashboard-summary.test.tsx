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
import { multiSelectCopy } from "../../../shared/ui/multi-select";
import type { SeriesStorage } from "./series/series-selection";
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

function renderDashboard(
  fetchImpl: FetchLike,
  seriesStorage: SeriesStorage | null = null,
) {
  return render(
    <FinancialDataProvider>
      <DashboardSummary
        client={createApiClient({ fetch: fetchImpl })}
        seriesStorage={seriesStorage}
      />
    </FinancialDataProvider>,
  );
}

function memoryStorage(initial: Record<string, string> = {}): SeriesStorage & {
  readonly entries: Record<string, string>;
} {
  const entries: Record<string, string> = { ...initial };

  return {
    entries,
    getItem: (key) => entries[key] ?? null,
    setItem: (key, value) => {
      entries[key] = value;
    },
  };
}

/** The section a heading belongs to, so repeated controls stay addressable. */
function sectionOf(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: title });
  const section = heading.closest("section");

  if (section === null) {
    throw new Error(`The ${title} block is not a section.`);
  }

  return section;
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

  it("announces the series and the averages that have not arrived yet", async () => {
    const fetchImpl = vi.fn<FetchLike>((path, init) => {
      if (
        path.startsWith("/api/analytics/evolution") ||
        path.startsWith("/api/analytics/averages")
      ) {
        // A window that is still travelling must not hide the period figures.
        return new Promise<Response>(() => undefined);
      }

      return dashboardFetch()(path, init);
    });

    renderDashboard(fetchImpl);
    await waitForIncome("2500,00 €");

    expect(screen.getByText(dashboardCopy.trendLoading)).toBeVisible();
    expect(screen.getByText(dashboardCopy.averagesLoading)).toBeVisible();
  });

  it("explains failed averages without hiding the figures of the period", async () => {
    renderDashboard(
      dashboardFetch({
        averagesResponse: () =>
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
      }),
    );

    await waitForIncome("2500,00 €");
    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(dashboardCopy.averagesErrorTitle);
    expect(alert).toHaveTextContent(API_ERROR_MESSAGE.serviceUnavailable);
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
    // The distribution and the monthly average of the tags both carry it.
    expect(screen.getAllByText(dashboardCopy.tagOverlap)).toHaveLength(2);
  });
});

describe("DashboardSummary series selection", () => {
  it("shares one selection between the distribution and the average", async () => {
    const storage = memoryStorage();
    renderDashboard(dashboardFetch(), storage);
    await waitForIncome("2500,00 €");

    const distribution = sectionOf(dashboardCopy.categoryTitle);
    await userEvent.click(
      within(distribution).getByRole("button", {
        name: `${dashboardCopy.categorySelectorTrigger} · 1`,
      }),
    );
    const panel = screen.getByRole("dialog", {
      name: dashboardCopy.categorySelectorTitle,
    });
    await userEvent.click(
      within(panel).getByRole("checkbox", { name: "Alimentación" }),
    );
    await userEvent.click(
      within(panel).getByRole("button", { name: multiSelectCopy.apply }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("table", { name: dashboardCopy.categoryCaption }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("table", {
        name: dashboardCopy.averageCategoryCaption,
      }),
    ).not.toBeInTheDocument();
    expect(storage.entries["dashboard:series:categories:personal"]).toBe("[]");
  });

  it("never lets the selection change a total, a card or a global average", async () => {
    renderDashboard(
      dashboardFetch(),
      memoryStorage({
        "dashboard:series:categories:personal": "[]",
        "dashboard:series:tags:personal": "[]",
      }),
    );
    await waitForIncome("2500,00 €");

    await waitFor(() => {
      expect(
        screen.getAllByRole("region", {
          name: dashboardCopy.selectionEmptyTitle,
        }),
      ).toHaveLength(4);
    });

    const cards = screen.getByRole("list", {
      name: dashboardCopy.summaryLabel,
    });
    expect(within(cards).getByText("1200,50 €")).toBeVisible();
    const averageCards = screen.getByRole("list", {
      name: dashboardCopy.averagesCaption,
    });
    expect(within(averageCards).getByText(/100,04/)).toBeVisible();
  });

  it("restores the stored selection when the dashboard is opened again", async () => {
    const storage = memoryStorage({
      "dashboard:series:categories:personal": '["cat-old"]',
    });
    const { unmount } = renderDashboard(dashboardFetch(), storage);
    await waitForIncome("2500,00 €");

    await waitFor(() => {
      expect(
        within(
          screen.getByRole("table", { name: dashboardCopy.categoryCaption }),
        ).getAllByRole("rowheader"),
      ).toHaveLength(1);
    });

    unmount();
    renderDashboard(dashboardFetch(), storage);
    await waitForIncome("2500,00 €");

    await waitFor(() => {
      expect(
        within(
          screen.getByRole("table", { name: dashboardCopy.categoryCaption }),
        ).getByRole("rowheader", { name: /Antigua/ }),
      ).toBeVisible();
    });
  });

  it("keeps the selection while a mutation recalculates the figures", async () => {
    const storage = memoryStorage({
      "dashboard:series:tags:personal": '["tag-trips"]',
    });
    renderDashboard(
      dashboardFetch({ summaries: [summary, recalculatedSummary] }),
      storage,
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
    const tagTable = screen.getByRole("table", {
      name: dashboardCopy.tagCaption,
    });
    expect(within(tagTable).getAllByRole("rowheader")).toHaveLength(1);
    expect(
      within(tagTable).getByRole("rowheader", { name: /Viajes/ }),
    ).toBeVisible();
  });
});
