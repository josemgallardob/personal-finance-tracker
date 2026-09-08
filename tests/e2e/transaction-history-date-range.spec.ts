import { expect, test } from "@playwright/test";

import { historyCopy } from "../../src/modules/transactions/ui/history-copy";
import {
  expenseCategory,
  fillRequiredFields,
  goToHistory,
  incomeCategory,
} from "./helpers";

const datedExpense = "Rango gasto E2E";
const datedIncome = "Rango ingreso E2E";

async function createMovementFromShell(
  page: import("@playwright/test").Page,
  options: {
    amount: string;
    category: string;
    concept: string;
    type: "Gasto" | "Ingreso";
  },
): Promise<void> {
  await page.getByRole("button", { name: "Añadir movimiento" }).click();
  await expect(
    page.getByRole("dialog", { name: "Nuevo movimiento" }),
  ).toBeVisible();
  if (options.type === "Ingreso") {
    await page.locator("label").filter({ hasText: "Ingreso" }).click();
  }
  await fillRequiredFields(page, {
    amount: options.amount,
    category: options.category,
    concept: options.concept,
  });
  await page
    .getByRole("button", {
      name: options.type === "Ingreso" ? "Añadir ingreso" : "Añadir gasto",
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("movement history date range", () => {
  test("applies inclusive bounds, keeps cancel off the URL, and coexists with type", async ({
    page,
  }) => {
    await goToHistory(page);
    await createMovementFromShell(page, {
      amount: "5,00",
      category: expenseCategory,
      concept: datedExpense,
      type: "Gasto",
    });
    await createMovementFromShell(page, {
      amount: "9,00",
      category: incomeCategory,
      concept: datedIncome,
      type: "Ingreso",
    });

    const table = page.getByRole("table", { name: historyCopy.caption });
    await expect(
      table.getByRole("rowheader", { name: datedExpense }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: historyCopy.dateRangeLabel })
      .click();
    const dialog = page.getByRole("dialog", {
      name: historyCopy.dateRangeTitle,
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel(historyCopy.dateFromLabel, { exact: true })
      .fill("29/03/2026");
    await dialog
      .getByRole("button", { name: historyCopy.dateRangeCancel })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(page.url()).not.toMatch(/dateFrom=/);

    await page
      .getByRole("button", { name: historyCopy.dateRangeLabel })
      .click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel(historyCopy.dateFromLabel, { exact: true })
      .fill("02/08/2026");
    await dialog
      .getByLabel(historyCopy.dateToLabel, { exact: true })
      .fill("01/08/2026");
    await dialog
      .getByRole("button", { name: historyCopy.dateRangeApply })
      .click();
    await expect(
      dialog.getByText(historyCopy.dateInverted).first(),
    ).toBeVisible();
    await expect(
      dialog.getByLabel(historyCopy.dateFromLabel, { exact: true }),
    ).toHaveValue("02/08/2026");
    expect(page.url()).not.toMatch(/dateFrom=/);

    await dialog
      .getByLabel(historyCopy.dateFromLabel, { exact: true })
      .fill("29/03/2026");
    await dialog
      .getByLabel(historyCopy.dateToLabel, { exact: true })
      .fill("29/03/2026");
    await dialog
      .getByRole("button", { name: historyCopy.dateRangeApply })
      .click();
    await expect(page).toHaveURL(/dateFrom=2026-03-29/);
    await expect(page).toHaveURL(/dateTo=2026-03-29/);
    await expect(
      page.getByRole("region", { name: "Sin resultados" }),
    ).toBeVisible();

    await page.getByRole("button", { name: historyCopy.clearFilters }).click();
    await page.getByLabel(historyCopy.typeLabel).selectOption("expense");
    await page
      .getByRole("button", { name: historyCopy.dateRangeLabel })
      .click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel(historyCopy.dateFromLabel, { exact: true })
      .fill("01/01/2026");
    await dialog
      .getByRole("button", { name: historyCopy.dateRangeApply })
      .click();
    await expect(page).toHaveURL(/dateFrom=2026-01-01/);
    await expect(page).toHaveURL(/type=expense/);
    await expect(
      table.getByRole("rowheader", { name: datedExpense }),
    ).toBeVisible();
    await expect(
      table.getByRole("rowheader", { name: datedIncome }),
    ).toHaveCount(0);
  });
});

test.describe("movement history date range on a mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("opens the compact panel and still applies an open bound", async ({
    page,
  }) => {
    await goToHistory(page);
    await page
      .getByRole("button", { name: historyCopy.dateRangeLabel })
      .click();
    const dialog = page.getByRole("dialog", {
      name: historyCopy.dateRangeTitle,
    });
    await expect(
      dialog.locator("[data-date-range-layout='mobile']"),
    ).toBeVisible();
    await dialog
      .getByLabel(historyCopy.dateToLabel, { exact: true })
      .fill("31/12/2026");
    await dialog
      .getByRole("button", { name: historyCopy.dateRangeApply })
      .click();
    await expect(page).toHaveURL(/dateTo=2026-12-31/);
    await expect(
      page.getByRole("group", { name: historyCopy.filtersLabel }),
    ).toBeVisible();
  });
});
