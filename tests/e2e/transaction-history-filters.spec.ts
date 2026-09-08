import { expect, test } from "@playwright/test";

import { emptyStateCopy } from "../../src/shared/ui/empty-state";
import { historyCopy } from "../../src/modules/transactions/ui/history-copy";
import {
  expenseCategory,
  fillRequiredFields,
  goToHistory,
  incomeCategory,
} from "./helpers";

const cafeConcept = "Filtro Café & té E2E";
const salaryConcept = "Filtro nómina E2E";
const unmatchedQuery = "zzzz-sin-resultados-e2e";

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

test.describe("movement history filters", () => {
  test("debounces search, restores filters on back, and keeps no-results distinct", async ({
    page,
  }) => {
    await goToHistory(page);
    await createMovementFromShell(page, {
      amount: "11,00",
      category: expenseCategory,
      concept: cafeConcept,
      type: "Gasto",
    });
    await createMovementFromShell(page, {
      amount: "900,00",
      category: incomeCategory,
      concept: salaryConcept,
      type: "Ingreso",
    });

    const table = page.getByRole("table", { name: historyCopy.caption });
    await expect(
      table.getByRole("rowheader", { name: cafeConcept }),
    ).toBeVisible();
    await expect(
      table.getByRole("rowheader", { name: salaryConcept }),
    ).toBeVisible();

    await expect(
      page.getByRole("group", { name: historyCopy.filtersLabel }),
    ).toBeVisible();

    await page.getByLabel(historyCopy.searchLabel).fill(cafeConcept);
    expect(page.url()).not.toMatch(/q=/);
    await expect(page).toHaveURL(/q=/);
    await expect(page).toHaveURL(/Caf/);
    await expect(page).toHaveURL(/%26/);
    await expect(
      table.getByRole("rowheader", { name: cafeConcept }),
    ).toBeVisible();
    await expect(
      table.getByRole("rowheader", { name: salaryConcept }),
    ).toHaveCount(0);

    await page.getByLabel(historyCopy.typeLabel).selectOption("income");
    await expect(
      page.getByRole("region", { name: emptyStateCopy.noResults.title }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", {
        name: emptyStateCopy.noTransactions.title,
      }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: historyCopy.clearFilters }).click();
    await expect(
      table.getByRole("rowheader", { name: salaryConcept }),
    ).toBeVisible();
    await expect(
      table.getByRole("rowheader", { name: cafeConcept }),
    ).toBeVisible();

    await page.getByLabel(historyCopy.typeLabel).selectOption("expense");
    await expect(
      table.getByRole("rowheader", { name: cafeConcept }),
    ).toBeVisible();
    await expect(
      table.getByRole("rowheader", { name: salaryConcept }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: historyCopy.removeFilter(historyCopy.expense),
      }),
    ).toBeVisible();

    await page.goBack();
    await expect(
      table.getByRole("rowheader", { name: salaryConcept }),
    ).toBeVisible();
    await expect(page.getByLabel(historyCopy.typeLabel)).toHaveValue("");

    await page.goForward();
    await expect(page.getByLabel(historyCopy.typeLabel)).toHaveValue("expense");
    await expect(
      table.getByRole("rowheader", { name: cafeConcept }),
    ).toBeVisible();

    await page.getByLabel(historyCopy.searchLabel).fill(unmatchedQuery);
    await expect(
      page.getByRole("region", { name: emptyStateCopy.noResults.title }),
    ).toBeVisible();
  });
});
