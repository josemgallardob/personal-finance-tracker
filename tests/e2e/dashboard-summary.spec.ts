import { expect, test, type Page } from "@playwright/test";

import { dashboardCopy } from "../../src/modules/analytics/ui/dashboard-copy";
import {
  chooseMovementType,
  fillRequiredFields,
  incomeCategory,
  openCreateDialog,
} from "./helpers";

const incomeConcept = "Ingreso panel E2E";

/** Reads a card figure as an exact number of EUR, dropping the locale marks. */
async function cardAmount(
  page: Page,
  card: "income" | "expense" | "net",
): Promise<number> {
  const text = await page
    .locator(`[data-summary-card="${card}"] [data-summary-amount]`)
    .innerText();
  const normalized = text
    .replace(/[^\d,.-]/g, "")
    .replaceAll(".", "")
    .replace(",", ".");

  return Number(normalized);
}

async function waitForDashboard(page: Page): Promise<void> {
  await expect(
    page.getByRole("list", { name: dashboardCopy.summaryLabel }),
  ).toBeVisible();
}

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
