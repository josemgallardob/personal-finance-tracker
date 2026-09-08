import { expect, test } from "@playwright/test";

import { transactionMaintenanceCopy } from "../../src/modules/transactions/ui/transaction-dialog-support";
import {
  expenseCategory,
  fillRequiredFields,
  listMovements,
  openCreateDialog,
} from "./helpers";

async function createSeedExpense(page: import("@playwright/test").Page) {
  await openCreateDialog(page);
  await fillRequiredFields(page, {
    amount: "12,50",
    category: expenseCategory,
    concept: "Mantenimiento E2E",
  });
  await page.getByRole("button", { name: "Añadir gasto" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("maintenance dialogs until history exists", () => {
  test("edits type and amount through the component harness", async ({
    page,
    request,
  }) => {
    await createSeedExpense(page);
    const [movement] = (await listMovements(request)).filter(
      (item) => item.concept === "Mantenimiento E2E",
    );
    expect(movement).toBeDefined();

    await page.goto(`/e2e/maintenance?mode=edit&id=${movement.id}`);
    await expect(
      page.getByRole("dialog", { name: transactionMaintenanceCopy.editTitle }),
    ).toBeVisible();
    await page.getByLabel(/Importe/).fill("15,00");
    await page
      .getByRole("button", { name: transactionMaintenanceCopy.saveEdit })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const updated = await request.get(`/api/transactions/${movement.id}`);
    expect(updated.ok()).toBe(true);
    expect(await updated.json()).toMatchObject({
      data: { id: movement.id, amountMinor: 1500, type: "expense" },
    });
  });

  test("duplicates only after confirm and never copies the original id", async ({
    page,
    request,
  }) => {
    await createSeedExpense(page);
    const original = (await listMovements(request)).find(
      (item) => item.concept === "Mantenimiento E2E",
    );
    expect(original).toBeDefined();
    const before = await listMovements(request);

    await page.goto(`/e2e/maintenance?mode=duplicate&id=${original?.id}`);
    await expect(
      page.getByRole("dialog", {
        name: transactionMaintenanceCopy.duplicateTitle,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await listMovements(request)).toHaveLength(before.length);

    await page.goto(`/e2e/maintenance?mode=duplicate&id=${original?.id}`);
    await page.getByLabel("Concepto").fill("Copia E2E");
    await page
      .getByRole("button", {
        name: transactionMaintenanceCopy.saveDuplicateExpense,
      })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const after = await listMovements(request);
    expect(after).toHaveLength(before.length + 1);
    expect(after).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: original?.id,
          concept: "Mantenimiento E2E",
        }),
        expect.objectContaining({
          concept: "Copia E2E",
          amountMinor: 1250,
          type: "expense",
        }),
      ]),
    );
    const copy = after.find((item) => item.concept === "Copia E2E");
    expect(copy?.id).not.toBe(original?.id);
  });

  test("keeps the movement on cancel and deletes it on confirm", async ({
    page,
    request,
  }) => {
    await createSeedExpense(page);
    const movement = (await listMovements(request)).find(
      (item) => item.concept === "Mantenimiento E2E",
    );
    expect(movement).toBeDefined();

    await page.goto(`/e2e/maintenance?mode=delete&id=${movement?.id}`);
    await expect(
      page.getByRole("dialog", {
        name: transactionMaintenanceCopy.deleteTitle,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (await listMovements(request)).some((item) => item.id === movement?.id),
    ).toBe(true);

    await page.goto(`/e2e/maintenance?mode=delete&id=${movement?.id}`);
    await page
      .getByRole("button", { name: transactionMaintenanceCopy.deleteConfirm })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const missing = await request.get(`/api/transactions/${movement?.id}`);
    expect(missing.status()).toBe(404);
  });
});
