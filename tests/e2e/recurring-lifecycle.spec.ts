import { expect, test } from "@playwright/test";

import { recurringCopy } from "../../src/modules/recurring/ui/recurring-copy";
import { e2eRecurringHarnessCopy } from "../../src/app/e2e/recurring/harness";
import { e2eOrigin } from "./origin";

interface RuleDto {
  readonly id: string;
  readonly nextDueDate: string;
  readonly sourceTransactionId: string;
}

function nextFebruary(date: string): string {
  const [year = 2026, month = 1] = date.split("-").map(Number);
  const targetYear = month <= 2 ? year : year + 1;
  return `${String(targetYear)}-02-28`;
}

async function createActiveMonthlyRule(
  request: import("@playwright/test").APIRequestContext,
): Promise<RuleDto> {
  const categoriesResponse = await request.get("/api/categories");
  expect(categoriesResponse.ok()).toBe(true);
  const categories = (await categoriesResponse.json()) as {
    data: Array<{ id: string; name: string; type: string }>;
  };
  const category = categories.data.find(
    (item) => item.name === "Alquiler" && item.type === "expense",
  );
  expect(category).toBeDefined();

  const created = await request.post("/api/transactions", {
    headers: { "content-type": "application/json", origin: e2eOrigin() },
    data: {
      type: "expense",
      amountMinor: 12_500,
      date: "2026-09-08",
      categoryId: category?.id,
      concept: "Recurrencia E2E",
    },
  });
  expect(created.ok()).toBe(true);
  const transaction = (await created.json()) as { data: { id: string } };

  const activated = await request.post("/api/recurring-rules", {
    headers: { "content-type": "application/json", origin: e2eOrigin() },
    data: { transactionId: transaction.data.id, monthlyDay: 31 },
  });
  expect(activated.ok()).toBe(true);
  return ((await activated.json()) as { data: RuleDto }).data;
}

async function runAt(
  page: import("@playwright/test").Page,
  date: string,
): Promise<void> {
  await page.goto("/e2e/recurring");
  await page.getByLabel(e2eRecurringHarnessCopy.dateLabel).fill(date);
  await page.getByRole("button", { name: e2eRecurringHarnessCopy.run }).click();
}

test.describe("recurring lifecycle with the E2E clock harness", () => {
  test.afterEach(async ({ request }) => {
    const response = await request.get("/api/transactions?q=E2E");
    if (!response.ok()) {
      return;
    }
    const items = (
      (await response.json()) as { data: { items: Array<{ id: string }> } }
    ).data.items;
    await Promise.all(
      items.map((item) =>
        request.delete(`/api/transactions/${item.id}`, {
          headers: { origin: e2eOrigin() },
        }),
      ),
    );
  });

  test("recovers short-month dues exactly once, preserves a deletion, and stops after deactivation", async ({
    page,
    request,
  }) => {
    const rule = await createActiveMonthlyRule(request);
    const catchUpDate = nextFebruary(rule.nextDueDate);

    await runAt(page, catchUpDate);
    await expect(page.getByRole("status")).toContainText("Generadas:");
    const afterFirst = await request.get(
      "/api/transactions?q=Recurrencia%20E2E",
    );
    expect(afterFirst.ok()).toBe(true);
    const firstItems = (
      (await afterFirst.json()) as {
        data: { items: Array<{ id: string; date: string }> };
      }
    ).data.items;
    expect(firstItems.some((item) => item.date.endsWith("-02-28"))).toBe(true);

    await runAt(page, catchUpDate);
    await expect(page.getByRole("status")).toContainText("Generadas: 0");

    const generated = firstItems.find(
      (item) => item.id !== rule.sourceTransactionId,
    );
    expect(generated).toBeDefined();
    const deleted = await request.delete(`/api/transactions/${generated?.id}`, {
      headers: { origin: e2eOrigin() },
    });
    expect(deleted.ok()).toBe(true);

    await runAt(page, catchUpDate);
    await expect(page.getByRole("status")).toContainText("Generadas: 0");

    await page.goto("/transactions?tab=recurring");
    await page
      .getByRole("button", {
        name: recurringCopy.editActionOf("Recurrencia E2E"),
      })
      .click();
    const edit = page.getByRole("dialog", { name: recurringCopy.editTitle });
    await edit.getByLabel("Concepto").fill("Recurrencia editada E2E");
    await edit.getByRole("button", { name: recurringCopy.save }).click();
    await expect(page.getByText("Recurrencia editada E2E")).toBeVisible();

    await page
      .getByRole("button", {
        name: recurringCopy.deactivateActionOf("Recurrencia editada E2E"),
      })
      .click();
    await page
      .getByRole("button", { name: recurringCopy.deactivateConfirm })
      .click();
    await expect(page.getByText(recurringCopy.emptyTitle)).toBeVisible();

    await runAt(page, `${String(Number(catchUpDate.slice(0, 4)) + 1)}-12-31`);
    await expect(page.getByRole("status")).toContainText("Generadas: 0");
  });
});
