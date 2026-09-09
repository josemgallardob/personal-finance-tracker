import { expect, test, type Page } from "@playwright/test";

import { dashboardCopy } from "../../src/modules/analytics/ui/dashboard-copy";
import { historyCopy } from "../../src/modules/transactions/ui/history-copy";
import {
  createTaggedExpense,
  dashboardCardAmount,
  expenseCategory,
  fillRequiredFields,
  openCreateDialog,
  seedTiedHistoryExpenses,
  sumFilteredMovements,
  waitForDashboardCards,
} from "./helpers";

const drillDownTag = "Panel etiqueta E2E";
const drillDownConcept = "Gasto etiquetado E2E";
const refreshConcept = "Recalculo panel E2E";

/** Filters of a dashboard link, ready to be sent to the movements API. */
function apiFiltersOf(href: string): URLSearchParams {
  const url = new URL(href, "https://finanzas.local");
  const filters = new URLSearchParams(url.searchParams);
  filters.delete("tab");

  return filters;
}

async function hrefOf(page: Page, name: string): Promise<string> {
  const href = await page
    .getByRole("link", { name })
    .first()
    .getAttribute("href");
  expect(href).not.toBeNull();

  return href ?? "";
}

test.describe("dashboard drill-down", () => {
  test("a card total is the whole filtered history, not the page it opens", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    // More movements than one cursor page, so a card computed from the visible
    // page instead of the dataset could not match.
    await seedTiedHistoryExpenses(request, {
      conceptPrefix: "Panel dataset E2E",
      count: 32,
    });

    await page.goto("/");
    await waitForDashboardCards(page);

    const expenseCard = await dashboardCardAmount(page, "expense");
    const href = await hrefOf(page, dashboardCopy.viewExpense);
    const filters = apiFiltersOf(href);

    expect(filters.get("type")).toBe("expense");
    expect(filters.get("dateFrom")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(filters.get("dateTo")).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const { totalMinor, count } = await sumFilteredMovements(request, filters);
    expect(count).toBeGreaterThan(30);
    expect(expenseCard).toBeCloseTo(totalMinor / 100, 2);

    await page.getByRole("link", { name: dashboardCopy.viewExpense }).click();
    await expect(
      page.getByRole("heading", { name: "Movimientos", level: 1 }),
    ).toBeVisible();
    // The list opens on its first page while the card summed every movement.
    await expect(
      page
        .getByRole("table", { name: historyCopy.caption })
        .getByRole("rowheader"),
    ).toHaveCount(30);
  });

  test("navigates from a month, a tag and the untagged group, and returns to the same period", async ({
    page,
    request,
  }) => {
    await createTaggedExpense(request, {
      concept: drillDownConcept,
      amountMinor: 4500,
      tagName: drillDownTag,
    });

    await page.goto("/");
    await waitForDashboardCards(page);

    await page
      .getByRole("button", { name: dashboardCopy.previousMonth })
      .click();
    await expect(
      page.getByRole("button", { name: dashboardCopy.previousMonth }),
    ).toHaveAttribute("aria-pressed", "true");

    // The evolution keeps its own window, so its months are not the period.
    const monthLink = page
      .getByRole("table", { name: dashboardCopy.trendCaption })
      .getByRole("link")
      .last();
    const monthHref = (await monthLink.getAttribute("href")) ?? "";
    const monthFilters = apiFiltersOf(monthHref);
    expect(monthFilters.get("dateFrom")).toMatch(/^\d{4}-\d{2}-01$/);

    await monthLink.click();
    await expect(
      page.getByRole("heading", { name: "Movimientos", level: 1 }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("dateFrom")).toBe(
      monthFilters.get("dateFrom"),
    );

    // The shell names this destination "Inicio".
    await page.getByRole("link", { name: "Inicio" }).first().click();
    await waitForDashboardCards(page);
    await expect(
      page.getByRole("button", { name: dashboardCopy.previousMonth }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(new URL(page.url()).searchParams.toString()).toBe("");

    await page
      .getByRole("button", { name: dashboardCopy.currentMonth })
      .click();
    await waitForDashboardCards(page);

    const tagTable = page.getByRole("table", {
      name: dashboardCopy.tagCaption,
    });
    await expect(
      tagTable.getByRole("rowheader", { name: drillDownTag }),
    ).toBeVisible();
    const tagHref = await hrefOf(page, drillDownTag);
    expect(apiFiltersOf(tagHref).get("tagId")).not.toBeNull();

    await page.getByRole("link", { name: drillDownTag }).first().click();
    await expect(
      page
        .getByRole("table", { name: historyCopy.caption })
        .getByRole("rowheader", { name: drillDownConcept }),
    ).toBeVisible();

    await page.goBack();
    await waitForDashboardCards(page);

    const untaggedHref = await hrefOf(page, dashboardCopy.untagged);
    expect(apiFiltersOf(untaggedHref).get("untagged")).toBe("true");
    expect(apiFiltersOf(untaggedHref).get("tagId")).toBeNull();

    await page
      .getByRole("link", { name: dashboardCopy.untagged })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Movimientos", level: 1 }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: historyCopy.chipsLabel })
        .getByText(historyCopy.noTags),
    ).toBeVisible();
    await expect(
      page
        .getByRole("table", { name: historyCopy.caption })
        .getByRole("rowheader", { name: drillDownConcept }),
    ).toHaveCount(0);
  });

  test("recalculates the summary, the evolution and the averages after a mutation", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForDashboardCards(page);
    await expect(
      page.getByRole("heading", { name: dashboardCopy.averagesTitle }),
    ).toBeVisible();

    const analyticsCalls: string[] = [];
    page.on("request", (pageRequest) => {
      const path = new URL(pageRequest.url()).pathname;
      if (path.startsWith("/api/analytics/")) {
        analyticsCalls.push(path);
      }
    });

    await openCreateDialog(page);
    await fillRequiredFields(page, {
      amount: "9,00",
      category: expenseCategory,
      concept: refreshConcept,
    });
    await page.getByRole("button", { name: "Añadir gasto" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect
      .poll(() => new Set(analyticsCalls).size, { timeout: 15_000 })
      .toBe(3);
    expect(new Set(analyticsCalls)).toEqual(
      new Set([
        "/api/analytics/summary",
        "/api/analytics/evolution",
        "/api/analytics/averages",
      ]),
    );
    await expect(
      page
        .getByRole("list", { name: dashboardCopy.recentCaption })
        .getByText(refreshConcept),
    ).toBeVisible();
  });

  test("explains a refused window without hiding the two that answered", async ({
    page,
  }) => {
    await page.route("**/api/analytics/summary*", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json; charset=utf-8",
        headers: { "x-request-id": "e2e-partial-failure" },
        body: JSON.stringify({
          error: {
            code: "serviceUnavailable",
            message: "El servicio no está disponible temporalmente.",
            requestId: "e2e-partial-failure",
          },
        }),
      }),
    );

    await page.goto("/");

    // The route announcer of the framework also carries the alert role, so the
    // count is taken inside the page content.
    const alerts = page.locator('main [role="alert"]');
    await expect(alerts).toHaveCount(1);
    await expect(alerts).toContainText(dashboardCopy.errorTitle);
    await expect(
      page.getByRole("heading", { name: dashboardCopy.trendTitle, level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: dashboardCopy.averagesTitle,
        level: 2,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: dashboardCopy.summaryLabel }),
    ).toHaveCount(0);

    await page.unroute("**/api/analytics/summary*");
    await page.getByRole("button", { name: dashboardCopy.retry }).click();
    await waitForDashboardCards(page);
    await expect(alerts).toHaveCount(0);
  });
});
