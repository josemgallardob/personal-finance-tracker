import { expect, test } from "@playwright/test";

import { transactionMaintenanceCopy } from "../../src/modules/transactions/ui/transaction-dialog-support";
import { historyCopy } from "../../src/modules/transactions/ui/history-copy";
import {
  expenseCategory,
  fillRequiredFields,
  goToHistory,
  listMovements,
  openCreateDialog,
  openHistoryActions,
} from "./helpers";

const originalConcept = "Historial original E2E";
const editedConcept = "Historial editado E2E";
const duplicateConcept = "Historial copia E2E";
const olderConcept = "Historial anterior E2E";
const newerConcept = "Historial reciente E2E";

async function createExpenseFromShell(
  page: import("@playwright/test").Page,
  concept: string,
  amount: string,
): Promise<void> {
  await page.getByRole("button", { name: "Añadir movimiento" }).click();
  await expect(
    page.getByRole("dialog", { name: "Nuevo movimiento" }),
  ).toBeVisible();
  await fillRequiredFields(page, {
    amount,
    category: expenseCategory,
    concept,
  });
  await page.getByRole("button", { name: "Añadir gasto" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("movement history", () => {
  test("keeps Recurrentes as a placeholder next to the Todos history", async ({
    page,
  }) => {
    await goToHistory(page);
    await expect(
      page.getByRole("tab", { name: historyCopy.allTab }),
    ).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: historyCopy.recurringTab }).click();
    await expect(
      page.getByRole("region", { name: historyCopy.recurringTitle }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("creates, orders, edits, duplicates and deletes from the history", async ({
    page,
    request,
  }) => {
    await goToHistory(page);
    await createExpenseFromShell(page, olderConcept, "10,00");
    await createExpenseFromShell(page, newerConcept, "20,00");

    const table = page.getByRole("table", { name: historyCopy.caption });
    await expect(table.getByRole("rowheader").nth(0)).toHaveText(newerConcept);
    await expect(table.getByRole("rowheader").nth(1)).toHaveText(olderConcept);

    await createExpenseFromShell(page, originalConcept, "12,50");
    await expect(
      table.getByRole("rowheader", { name: originalConcept }),
    ).toBeVisible();

    await openHistoryActions(page, originalConcept);
    await page.getByRole("menuitem", { name: historyCopy.editAction }).click();
    const editDialog = page.getByRole("dialog", {
      name: transactionMaintenanceCopy.editTitle,
    });
    await expect(editDialog).toBeVisible();
    await editDialog.getByLabel("Concepto").fill(editedConcept);
    await editDialog
      .getByRole("button", { name: transactionMaintenanceCopy.saveEdit })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      table.getByRole("rowheader", { name: editedConcept }),
    ).toBeVisible();

    await openHistoryActions(page, editedConcept);
    await page
      .getByRole("menuitem", { name: historyCopy.duplicateAction })
      .click();
    const duplicateDialog = page.getByRole("dialog", {
      name: transactionMaintenanceCopy.duplicateTitle,
    });
    await expect(duplicateDialog).toBeVisible();
    await duplicateDialog.getByLabel("Concepto").fill(duplicateConcept);
    await duplicateDialog
      .getByRole("button", {
        name: transactionMaintenanceCopy.saveDuplicateExpense,
      })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      table.getByRole("rowheader", { name: duplicateConcept }),
    ).toBeVisible();
    await expect(
      table.getByRole("rowheader", { name: editedConcept }),
    ).toBeVisible();

    const afterDuplicate = await listMovements(request);
    expect(afterDuplicate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ concept: editedConcept }),
        expect.objectContaining({ concept: duplicateConcept }),
      ]),
    );
    const original = afterDuplicate.find(
      (item) => item.concept === editedConcept,
    );
    const copy = afterDuplicate.find(
      (item) => item.concept === duplicateConcept,
    );
    expect(copy?.id).not.toBe(original?.id);

    await openHistoryActions(page, duplicateConcept);
    await page
      .getByRole("menuitem", { name: historyCopy.deleteAction })
      .click();
    const deleteDialog = page.getByRole("dialog", {
      name: transactionMaintenanceCopy.deleteTitle,
    });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog
      .getByRole("button", { name: transactionMaintenanceCopy.deleteConfirm })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      table.getByRole("rowheader", { name: duplicateConcept }),
    ).toHaveCount(0);
    await expect(
      table.getByRole("rowheader", { name: editedConcept }),
    ).toBeVisible();
    const missing = await request.get(`/api/transactions/${copy?.id}`);
    expect(missing.status()).toBe(404);
  });

  test("keeps desktop table semantics and keyboard access to the row menu", async ({
    page,
  }) => {
    await goToHistory(page);
    await createExpenseFromShell(page, "Historial teclado E2E", "8,00");

    await expect(page.locator('[data-history-layout="desktop"]')).toBeVisible();
    await expect(page.locator('[data-history-layout="mobile"]')).toBeHidden();
    await expect(
      page.getByRole("columnheader", { name: historyCopy.amountColumn }),
    ).toBeVisible();

    await page
      .getByRole("button", {
        name: historyCopy.actionsOf("Historial teclado E2E"),
      })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});

test.describe("movement history on a mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("uses stacked rows and still reaches edit from the row menu", async ({
    page,
  }) => {
    await page.goto("/");
    await openCreateDialog(page);
    await fillRequiredFields(page, {
      amount: "7,00",
      category: expenseCategory,
      concept: "Historial móvil E2E",
    });
    await page.getByRole("button", { name: "Añadir gasto" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await goToHistory(page);
    await expect(page.locator('[data-history-layout="mobile"]')).toBeVisible();
    await expect(page.locator('[data-history-layout="desktop"]')).toBeHidden();
    await expect(
      page.getByRole("list", { name: historyCopy.caption }),
    ).toContainText("Historial móvil E2E");

    await openHistoryActions(page, "Historial móvil E2E");
    await page.getByRole("menuitem", { name: historyCopy.editAction }).click();
    await expect(
      page.getByRole("dialog", { name: transactionMaintenanceCopy.editTitle }),
    ).toBeVisible();
  });
});
