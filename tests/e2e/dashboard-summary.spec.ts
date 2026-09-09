import { expect, test, type Page } from "@playwright/test";

import { dashboardCopy } from "../../src/modules/analytics/ui/dashboard-copy";
import {
  chooseMovementType,
  dashboardCardAmount,
  fillRequiredFields,
  incomeCategory,
  openCreateDialog,
  waitForDashboardCards,
} from "./helpers";

const incomeConcept = "Ingreso panel E2E";

const cardAmount = dashboardCardAmount;
const waitForDashboard = waitForDashboardCards;

test.describe("financial dashboard", () => {
  test("recalculates the cards after an income and keeps its period across the history", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForDashboard(page);

    await expect(
      page.getByRole("button", { name: dashboardCopy.currentMonth }),
    ).toHaveAttribute("aria-pressed", "true");
    const incomeBefore = await cardAmount(page, "income");
    const netBefore = await cardAmount(page, "net");

    await openCreateDialog(page);
    await chooseMovementType(page, "Ingreso");
    await fillRequiredFields(page, {
      amount: "20,00",
      category: incomeCategory,
      concept: incomeConcept,
    });
    await page.getByRole("button", { name: "Añadir ingreso" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect
      .poll(() => cardAmount(page, "income"))
      .toBeCloseTo(incomeBefore + 20, 2);
    expect(await cardAmount(page, "net")).toBeCloseTo(netBefore + 20, 2);
    await expect(
      page.getByRole("list", { name: dashboardCopy.recentCaption }),
    ).toContainText(incomeConcept);

    await page
      .getByRole("link", { name: dashboardCopy.viewIncome })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Movimientos", level: 1 }),
    ).toBeVisible();
    expect(page.url()).toContain("dateFrom=");
    expect(page.url()).toContain("type=income");

    await page.getByRole("link", { name: "Inicio" }).first().click();
    await waitForDashboard(page);
    await expect(
      page.getByRole("button", { name: dashboardCopy.currentMonth }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(page.url()).not.toContain("dateFrom=");
  });

  test("selects a custom range of complete months from the dialog", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForDashboard(page);

    await page
      .getByRole("button", { name: new RegExp(dashboardCopy.customMonthRange) })
      .click();
    const dialog = page.getByRole("dialog", {
      name: dashboardCopy.monthRangeTitle,
    });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(dashboardCopy.monthFromLabel).fill("2026-01");
    await dialog.getByLabel(dashboardCopy.monthToLabel).fill("2026-03");
    await dialog
      .getByRole("button", { name: dashboardCopy.monthRangeApply })
      .click();

    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: `${dashboardCopy.customMonthRange}: 01/2026 – 03/2026`,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText(dashboardCopy.periodRange("01/01/2026 – 31/03/2026")),
    ).toBeVisible();
  });
});

test.describe("dashboard series selection", () => {
  test("hides bars without touching the totals, and states the averages window", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForDashboard(page);

    await expect(
      page.getByRole("heading", {
        name: dashboardCopy.averagesTitle,
        level: 2,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(dashboardCopy.averagesExcludesCurrentMonth),
    ).toBeVisible();
    // Every movement of this suite is dated today, so no month has closed yet.
    await expect(
      page.getByRole("heading", { name: "Sin histórico suficiente" }),
    ).toBeVisible();

    const expenseBefore = await cardAmount(page, "expense");
    const distribution = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: dashboardCopy.categoryTitle }),
      })
      .first();

    await distribution
      .getByRole("button", {
        name: new RegExp(`^${dashboardCopy.categorySelectorTrigger} · `),
      })
      .click();
    const panel = page.getByRole("dialog", {
      name: dashboardCopy.categorySelectorTitle,
    });
    await panel.getByRole("button", { name: "Quitar todas" }).click();
    await panel.getByRole("button", { name: "Aplicar" }).click();

    await expect(
      page.getByRole("region", { name: dashboardCopy.selectionEmptyTitle }),
    ).toBeVisible();
    expect(await cardAmount(page, "expense")).toBeCloseTo(expenseBefore, 2);

    await page
      .getByRole("region", { name: dashboardCopy.selectionEmptyTitle })
      .getByRole("button", { name: dashboardCopy.selectAll })
      .click();
    await expect(
      page.getByRole("table", { name: dashboardCopy.categoryCaption }),
    ).toBeVisible();
  });
});

/** Horizontal overflow of the document, in CSS pixels. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test.describe("financial dashboard on a narrow viewport", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("keeps every chart section readable without horizontal scroll", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForDashboard(page);

    for (const title of [
      dashboardCopy.comparisonTitle,
      dashboardCopy.trendTitle,
      dashboardCopy.categoryTitle,
      dashboardCopy.tagTitle,
    ]) {
      await expect(
        page.getByRole("heading", { name: title, level: 2 }),
      ).toBeVisible();
    }

    await expect(
      page.locator(
        '[data-chart="monthly-trend"] .recharts-responsive-container',
      ),
    ).toBeVisible();
    await expect(page.getByText(dashboardCopy.trendIndependent)).toBeVisible();
    await expect(page.getByText(dashboardCopy.tagOverlap)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Half the usual viewport is what a 200 % zoom leaves to the layout.
    await page.setViewportSize({ width: 640, height: 512 });
    await expect(
      page.getByRole("heading", { name: dashboardCopy.tagTitle, level: 2 }),
    ).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
