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
  await page.getByLabel(/Importe/).fill(options.amount);
  await page.getByLabel(/Categoría/).selectOption({ label: options.category });
  if (options.concept !== undefined) {
    await page.getByLabel("Concepto").fill(options.concept);
  }
}
