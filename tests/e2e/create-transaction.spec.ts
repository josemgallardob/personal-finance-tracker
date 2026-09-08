import { expect, test } from "@playwright/test";

import {
  expenseCategory,
  fillRequiredFields,
  incomeCategory,
  listMovements,
  openCreateDialog,
  chooseMovementType,
} from "./helpers";

test.describe("create movements from the shell", () => {
  test("persists an expense and an income after close and reopen", async ({
    page,
    request,
  }) => {
    await openCreateDialog(page);
    await fillRequiredFields(page, {
      amount: "12,50",
      category: expenseCategory,
      concept: "Supermercado E2E",
    });
    await page.getByRole("button", { name: "Añadir gasto" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.reload();
    const afterExpense = await listMovements(request);
    expect(afterExpense).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "expense",
          amountMinor: 1250,
          concept: "Supermercado E2E",
        }),
      ]),
    );

    await openCreateDialog(page);
    await chooseMovementType(page, "Ingreso");
    await fillRequiredFields(page, {
      amount: "20,00",
      category: incomeCategory,
      concept: "Nómina E2E",
    });
    await page.getByRole("button", { name: "Añadir ingreso" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.reload();
    const afterIncome = await listMovements(request);
    expect(afterIncome).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "expense",
          amountMinor: 1250,
          concept: "Supermercado E2E",
        }),
        expect.objectContaining({
          type: "income",
          amountMinor: 2000,
          concept: "Nómina E2E",
        }),
      ]),
    );
  });

  test("does not persist a cancelled expense", async ({ page, request }) => {
    const before = await listMovements(request);
    await openCreateDialog(page);
    await fillRequiredFields(page, {
      amount: "9,99",
      category: expenseCategory,
      concept: "Cancelado E2E",
    });
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await listMovements(request)).toEqual(before);
  });
});
