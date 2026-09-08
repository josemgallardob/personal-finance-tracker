import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { e2eOrigin } from "./origin";

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

interface CategoryListEnvelope {
  data: Array<{ id: string; name: string; type: "expense" | "income" }>;
}

interface PreferencesEnvelope {
  data: { today: string };
}

/** Seeds same-date expenses so the history must walk more than one cursor page. */
export async function seedTiedHistoryExpenses(
  request: APIRequestContext,
  options: { conceptPrefix: string; count: number },
): Promise<string> {
  const [categoriesResponse, preferencesResponse] = await Promise.all([
    request.get("/api/categories"),
    request.get("/api/preferences"),
  ]);
  expect(categoriesResponse.ok()).toBe(true);
  expect(preferencesResponse.ok()).toBe(true);
  const categories = (await categoriesResponse.json()) as CategoryListEnvelope;
  const preferences = (await preferencesResponse.json()) as PreferencesEnvelope;
  const category = categories.data.find(
    (item) => item.name === expenseCategory && item.type === "expense",
  );
  expect(category).toEqual(expect.objectContaining({ id: expect.any(String) }));
  const date = preferences.data.today;

  for (let index = 0; index < options.count; index += 1) {
    const response = await request.post("/api/transactions", {
      headers: {
        "content-type": "application/json",
        origin: e2eOrigin(),
      },
      data: {
        type: "expense",
        amountMinor: 100 + index,
        date,
        categoryId: category?.id,
        concept: `${options.conceptPrefix} ${String(index).padStart(2, "0")}`,
      },
    });
    if (!response.ok()) {
      throw new Error(
        `seeded expense ${index} failed: ${response.status()} ${await response.text()}`,
      );
    }
  }

  return date;
}

export async function openHistoryActions(
  page: Page,
  label: string,
): Promise<void> {
  await page.getByRole("button", { name: `Acciones de ${label}` }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}
