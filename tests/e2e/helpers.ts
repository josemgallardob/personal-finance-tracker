import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { dashboardCopy } from "../../src/modules/analytics/ui/dashboard-copy";
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
    nextCursor: string | null;
  };
}

/**
 * Every stored movement, walking the cursor pages of the API.
 *
 * The endpoint answers one page at a time, so a suite that counts movements
 * must follow the cursor or it would silently stop at the page size.
 */
export async function listMovements(
  request: APIRequestContext,
): Promise<TransactionListEnvelope["data"]["items"]> {
  const items: TransactionListEnvelope["data"]["items"] = [];
  let cursor: string | null = null;

  do {
    const query =
      cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
    const response = await request.get(`/api/transactions${query}`);
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as TransactionListEnvelope;
    items.push(...body.data.items);
    cursor = body.data.nextCursor;
  } while (cursor !== null);

  return items;
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

/** Waits until the dashboard has painted the cards of its period. */
export async function waitForDashboardCards(page: Page): Promise<void> {
  await expect(
    page.getByRole("list", { name: dashboardCopy.summaryLabel }),
  ).toBeVisible();
}

/** Reads a dashboard card figure as an exact number of EUR units. */
export async function dashboardCardAmount(
  page: Page,
  card: "income" | "expense" | "net",
): Promise<number> {
  const text = await page
    .locator(`[data-summary-card="${card}"] [data-summary-amount]`)
    .innerText();
  // The interface writes a real minus sign, not a hyphen.
  const negative = text.includes("\u2212") || text.includes("-");
  const digits = text
    .replace(/[^\d,.]/g, "")
    .replaceAll(".", "")
    .replace(",", ".");

  return negative ? -Number(digits) : Number(digits);
}

/** Totals every movement of a filter, walking the cursor pages of the API. */
export async function sumFilteredMovements(
  request: APIRequestContext,
  filters: URLSearchParams,
): Promise<{ readonly totalMinor: number; readonly count: number }> {
  let cursor: string | null = null;
  let totalMinor = 0;
  let count = 0;

  do {
    const query = new URLSearchParams(filters);
    if (cursor !== null) {
      query.set("cursor", cursor);
    }

    const response = await request.get(`/api/transactions?${query.toString()}`);
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as {
      data: {
        items: Array<{ amountMinor: number }>;
        nextCursor: string | null;
      };
    };

    for (const item of body.data.items) {
      totalMinor += item.amountMinor;
      count += 1;
    }

    cursor = body.data.nextCursor;
  } while (cursor !== null);

  return { totalMinor, count };
}

/** Creates one expense with a tag through the API, and returns its date. */
export async function createTaggedExpense(
  request: APIRequestContext,
  options: { concept: string; amountMinor: number; tagName: string },
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
  const date = preferences.data.today;

  const response = await request.post("/api/transactions", {
    headers: { "content-type": "application/json", origin: e2eOrigin() },
    data: {
      type: "expense",
      amountMinor: options.amountMinor,
      date,
      categoryId: category?.id,
      concept: options.concept,
      tagInputs: [{ name: options.tagName }],
    },
  });

  if (!response.ok()) {
    throw new Error(
      `tagged expense failed: ${response.status()} ${await response.text()}`,
    );
  }

  return date;
}
