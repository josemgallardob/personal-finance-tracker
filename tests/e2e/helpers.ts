import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const expenseCategory = "Alquiler";
export const incomeCategory = "Sueldo";

interface TransactionListEnvelope {
  data: {
    items: Array<{
      id: string;
      type: "expense" | "income";
      amountMinor: number;
      categoryId: string;
      concept: string | null;
    }>;
  };
}

export async function listMovements(
  request: APIRequestContext,
): Promise<TransactionListEnvelope["data"]["items"]> {
  const response = await request.get("/api/transactions");
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as TransactionListEnvelope;
  return body.data.items;
}

export async function openCreateDialog(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Añadir movimiento" }).click();
  await expect(
    page.getByRole("dialog", { name: "Nuevo movimiento" }),
  ).toBeVisible();
}

export async function chooseMovementType(
  page: Page,
  type: "Gasto" | "Ingreso",
): Promise<void> {
  await page.locator("label").filter({ hasText: type }).click();
}

export async function fillRequiredFields(
  page: Page,
  options: { amount: string; category: string; concept?: string },
): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Importe/).fill(options.amount);
  await dialog
    .getByLabel(/Categoría/)
    .selectOption({ label: options.category });
  if (options.concept !== undefined) {
    await dialog.getByLabel("Concepto").fill(options.concept);
  }
}

export async function goToHistory(page: Page): Promise<void> {
  await page.goto("/transactions?tab=all");
  await expect(
    page.getByRole("heading", { name: "Movimientos", level: 1 }),
  ).toBeVisible();
}

export async function openHistoryActions(
  page: Page,
  label: string,
): Promise<void> {
  await page.getByRole("button", { name: `Acciones de ${label}` }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}
