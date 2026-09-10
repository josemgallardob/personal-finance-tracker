import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { dashboardCopy } from "../../src/modules/analytics/ui/dashboard-copy";
import { classificationCopy } from "../../src/modules/classification/ui/classification-copy";
import { classificationFormCopy } from "../../src/modules/classification/ui/classification-form";
import { recurringCopy } from "../../src/modules/recurring/ui/recurring-copy";
import { historyCopy } from "../../src/modules/transactions/ui/history-copy";
import {
  expenseCategory,
  fillRequiredFields,
  openCreateDialog,
} from "./helpers";
import { e2eOrigin } from "./origin";

/** Every drawing the dashboard paints once its period contains expenses. */
const dashboardCharts = [
  "income-expense",
  "expense-by-category",
  "expense-by-tag",
  "monthly-trend",
  "average-by-category",
  "average-by-tag",
] as const;

/** Table that publishes the same figures as each drawing above. */
const dashboardTables = [
  dashboardCopy.comparisonTitle,
  dashboardCopy.categoryCaption,
  dashboardCopy.tagCaption,
  dashboardCopy.trendCaption,
  dashboardCopy.averageCategoryCaption,
  dashboardCopy.averageTagCaption,
] as const;

async function expectNoCriticalAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter(
    (violation) => violation.impact === "critical",
  );

  expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
}

/**
 * Reads the focus ring the browser is actually painting on the active element.
 *
 * Restoring focus is not enough: a keyboard user must also see where it landed,
 * so the audit reads the resolved outline instead of trusting the class list.
 */
async function focusIndicator(page: Page): Promise<{
  readonly focusVisible: boolean;
  readonly outlineWidth: number;
  readonly outlineStyle: string;
}> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) {
      return { focusVisible: false, outlineWidth: 0, outlineStyle: "none" };
    }
    const style = getComputedStyle(element);

    return {
      focusVisible: element.matches(":focus-visible"),
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineStyle: style.outlineStyle,
    };
  });
}

async function expectVisibleFocusRing(page: Page): Promise<void> {
  const indicator = await focusIndicator(page);

  expect(indicator.focusVisible).toBe(true);
  expect(indicator.outlineStyle).not.toBe("none");
  expect(indicator.outlineWidth).toBeGreaterThanOrEqual(2);
}

async function closeWithEscapeAndRestoreFocus(
  page: Page,
  opener: Locator,
  dialogName: string,
): Promise<void> {
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await expectNoCriticalAxeViolations(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expectVisibleFocusRing(page);
}

async function openDashboard(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("list", { name: dashboardCopy.summaryLabel }),
  ).toBeVisible();
}

async function seedDashboardData(
  request: APIRequestContext,
): Promise<readonly string[]> {
  const [categoriesResponse, preferencesResponse] = await Promise.all([
    request.get("/api/categories"),
    request.get("/api/preferences"),
  ]);
  expect(categoriesResponse.ok()).toBe(true);
  expect(preferencesResponse.ok()).toBe(true);
  const categories = (await categoriesResponse.json()) as {
    data: Array<{ id: string; name: string; type: "expense" | "income" }>;
  };
  const preferences = (await preferencesResponse.json()) as {
    data: { today: string };
  };
  const expense = categories.data.find(
    (item) => item.name === "Alquiler" && item.type === "expense",
  );
  const income = categories.data.find(
    (item) => item.name === "Sueldo" && item.type === "income",
  );
  expect(expense).toBeDefined();
  expect(income).toBeDefined();
  const [year, month] = preferences.data.today.split("-").map(Number);
  const previous = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 2, 15))
    .toISOString()
    .slice(0, 10);
  const historicalStart = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 3, 15))
    .toISOString()
    .slice(0, 10);

  const transactionIds: string[] = [];
  for (const body of [
    {
      type: "expense",
      amountMinor: 1_000,
      date: historicalStart,
      categoryId: expense?.id,
      concept: "Inicio histórico accesible E2E",
    },
    {
      type: "expense",
      amountMinor: 4_000,
      date: previous,
      categoryId: expense?.id,
      concept: "Gráfico accesible E2E",
      tagInputs: [{ name: "Accesibilidad" }],
    },
    {
      type: "income",
      amountMinor: 10_000,
      date: previous,
      categoryId: income?.id,
      concept: "Ingreso accesible E2E",
    },
  ]) {
    const response = await request.post("/api/transactions", {
      headers: { "content-type": "application/json", origin: e2eOrigin() },
      data: body,
    });
    expect(response.ok()).toBe(true);
    const created = (await response.json()) as { data: { id: string } };
    transactionIds.push(created.data.id);
  }

  return transactionIds;
}

async function removeTransactions(
  request: APIRequestContext,
  transactionIds: readonly string[],
): Promise<void> {
  for (const transactionId of transactionIds) {
    const response = await request.delete(
      `/api/transactions/${transactionId}`,
      {
        headers: { origin: e2eOrigin() },
      },
    );
    expect(response.ok()).toBe(true);
  }
}

async function seedRecurringRule(
  request: APIRequestContext,
): Promise<{ readonly id: string; readonly templateVersion: number }> {
  const categoriesResponse = await request.get("/api/categories");
  expect(categoriesResponse.ok()).toBe(true);
  const categories = (await categoriesResponse.json()) as {
    data: Array<{ id: string; name: string; type: string }>;
  };
  const category = categories.data.find(
    (item) => item.name === "Alquiler" && item.type === "expense",
  );
  const created = await request.post("/api/transactions", {
    headers: { "content-type": "application/json", origin: e2eOrigin() },
    data: {
      type: "expense",
      amountMinor: 1_250,
      date: "2026-09-08",
      categoryId: category?.id,
      concept: "Regla accesible E2E",
    },
  });
  expect(created.ok()).toBe(true);
  const transaction = (await created.json()) as { data: { id: string } };
  const activated = await request.post("/api/recurring-rules", {
    headers: { "content-type": "application/json", origin: e2eOrigin() },
    data: { transactionId: transaction.data.id, monthlyDay: 8 },
  });
  expect(activated.ok()).toBe(true);
  return (
    (await activated.json()) as {
      data: { id: string; templateVersion: number };
    }
  ).data;
}

/** Private dashboard on the previous month, which paints every chart. */
async function openFullDashboard(
  page: Page,
  request: APIRequestContext,
): Promise<readonly string[]> {
  const transactionIds = await seedDashboardData(request);
  await openDashboard(page);
  await page.getByRole("button", { name: dashboardCopy.previousMonth }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("table", { name: dashboardCopy.averageTagCaption }),
  ).toBeVisible();
  return transactionIds;
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

/** Asserts that every drawing has a table and stays out of the a11y tree. */
async function expectChartsHaveEquivalentTables(page: Page): Promise<void> {
  for (const tableName of dashboardTables) {
    await expect(page.getByRole("table", { name: tableName })).toBeVisible();
  }

  for (const chartName of dashboardCharts) {
    await expect(page.locator(`[data-chart="${chartName}"]`)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  }

  // Any drawing added later must also stay hidden, not only the known ones.
  const painted = await page
    .locator("[data-chart]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-hidden")),
    );
  expect(painted).toHaveLength(dashboardCharts.length);
  expect(new Set(painted)).toEqual(new Set(["true"]));
}

/** Creates one movement so the history renders rows instead of its empty state. */
async function seedHistoryRow(page: Page, concept: string): Promise<void> {
  await openCreateDialog(page);
  await fillRequiredFields(page, {
    amount: "12,50",
    category: expenseCategory,
    concept,
  });
  await page.getByRole("button", { name: "Añadir gasto" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("accessibility audit", () => {
  test("exposes equivalent tables for every dashboard chart without critical axe violations", async ({
    page,
    request,
  }) => {
    const transactionIds = await openFullDashboard(page, request);
    try {
      await expectNoCriticalAxeViolations(page);
      await expectChartsHaveEquivalentTables(page);
    } finally {
      await removeTransactions(request, transactionIds);
    }
  });

  test("opens dashboard dialogs by keyboard and restores the trigger focus", async ({
    page,
  }) => {
    await openDashboard(page);

    await closeWithEscapeAndRestoreFocus(
      page,
      page.getByRole("button", {
        name: new RegExp(dashboardCopy.customMonthRange),
      }),
      dashboardCopy.monthRangeTitle,
    );

    await closeWithEscapeAndRestoreFocus(
      page,
      page
        .getByRole("button", {
          name: new RegExp(`^${dashboardCopy.categorySelectorTrigger} · `),
        })
        .first(),
      dashboardCopy.categorySelectorTitle,
    );
  });

  test("audits entry, filter, and maintenance dialogs with keyboard focus restoration", async ({
    page,
  }) => {
    await page.goto("/");
    const add = page.getByRole("button", { name: "Añadir movimiento" });
    await closeWithEscapeAndRestoreFocus(page, add, "Nuevo movimiento");

    await seedHistoryRow(page, "Accesibilidad E2E");

    await page.goto("/transactions?tab=all");
    const filter = page.getByRole("button", {
      name: historyCopy.dateRangeLabel,
    });
    await closeWithEscapeAndRestoreFocus(
      page,
      filter,
      historyCopy.dateRangeTitle,
    );

    const actions = page
      .getByRole("button", {
        name: historyCopy.actionsOf("Accesibilidad E2E"),
      })
      .last();
    await actions.focus();
    await page.keyboard.press("Enter");
    const editItem = page.getByRole("menuitem", {
      name: historyCopy.editAction,
    });
    await editItem.focus();
    await page.keyboard.press("Enter");
    const edit = page.getByRole("dialog", { name: "Editar movimiento" });
    await expect(edit).toBeVisible();
    await expectNoCriticalAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();
    await expectVisibleFocusRing(page);
  });

  test("audits the movement history table and its row menu", async ({
    page,
  }) => {
    await seedHistoryRow(page, "Tabla accesible E2E");

    await page.goto("/transactions?tab=all");
    const table = page.getByRole("table", { name: historyCopy.caption });
    await expect(table).toBeVisible();
    await expectNoCriticalAxeViolations(page);

    // Every column of the table announces itself, so a row is readable in a
    // screen reader without inferring meaning from the visual order.
    for (const column of [
      historyCopy.conceptColumn,
      historyCopy.categoryColumn,
      historyCopy.dateColumn,
      historyCopy.tagsColumn,
      historyCopy.amountColumn,
      historyCopy.actions,
    ]) {
      await expect(
        table.getByRole("columnheader", { name: column }),
      ).toBeVisible();
    }

    const actions = page
      .getByRole("button", {
        name: historyCopy.actionsOf("Tabla accesible E2E"),
      })
      .last();
    await actions.focus();
    await expectVisibleFocusRing(page);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNoCriticalAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(actions).toBeFocused();
    await expectVisibleFocusRing(page);
  });

  test("audits recurring rule dialogs with keyboard focus restoration", async ({
    page,
    request,
  }) => {
    const rule = await seedRecurringRule(request);
    try {
      await page.goto("/transactions?tab=recurring");
      await expect(
        page.getByRole("region", { name: recurringCopy.listLabel }),
      ).toBeVisible();
      await expectNoCriticalAxeViolations(page);

      await closeWithEscapeAndRestoreFocus(
        page,
        page.getByRole("button", { name: /^Editar / }).first(),
        recurringCopy.editTitle,
      );
      await closeWithEscapeAndRestoreFocus(
        page,
        page.getByRole("button", { name: /^Desactivar / }).first(),
        recurringCopy.deactivateTitle,
      );
    } finally {
      const deactivated = await request.post(
        `/api/recurring-rules/${rule.id}/deactivate`,
        {
          headers: {
            "content-type": "application/json",
            origin: e2eOrigin(),
          },
          data: { templateVersion: rule.templateVersion },
        },
      );
      expect(deactivated.ok()).toBe(true);
    }
  });

  test("audits category and tag dialogs without critical axe violations", async ({
    page,
  }) => {
    await page.goto("/categories");
    await expectNoCriticalAxeViolations(page);

    await closeWithEscapeAndRestoreFocus(
      page,
      page.getByRole("button", { name: classificationCopy.createCategory }),
      classificationFormCopy.createCategoryTitle,
    );
    await closeWithEscapeAndRestoreFocus(
      page,
      page.getByRole("button", { name: classificationCopy.createTag }),
      classificationFormCopy.createTagTitle,
    );
  });
});

test.describe("accessibility audit at 320 px", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("keeps dashboard tables, charts, dialogs, and focus reachable at narrow width", async ({
    page,
  }) => {
    await openDashboard(page);
    await expectNoCriticalAxeViolations(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const selector = page
      .getByRole("button", {
        name: new RegExp(`^${dashboardCopy.tagSelectorTrigger} · `),
      })
      .first();
    await closeWithEscapeAndRestoreFocus(
      page,
      selector,
      dashboardCopy.tagSelectorTitle,
    );
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("keeps the history list and its dialogs usable at narrow width", async ({
    page,
  }) => {
    await seedHistoryRow(page, "Historial estrecho E2E");

    await page.goto("/transactions?tab=all");
    await expect(
      page.getByRole("list", { name: historyCopy.caption }),
    ).toBeVisible();
    await expectNoCriticalAxeViolations(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await closeWithEscapeAndRestoreFocus(
      page,
      page.getByRole("button", { name: historyCopy.dateRangeLabel }),
      historyCopy.dateRangeTitle,
    );
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

/**
 * Reflow audit at 200 % browser zoom.
 *
 * A 1280 × 1024 window zoomed to 200 % leaves 640 × 512 CSS pixels, so the
 * viewport below reproduces what that reader sees: the same layout must keep
 * every figure, dialog and focus ring reachable without a horizontal scroll.
 */
test.describe("accessibility audit at 200 % zoom", () => {
  test.use({ viewport: { width: 640, height: 512 } });

  test("keeps every dashboard chart, table, and dialog reachable when zoomed", async ({
    page,
    request,
  }) => {
    const transactionIds = await openFullDashboard(page, request);
    try {
      await expectNoCriticalAxeViolations(page);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await expectChartsHaveEquivalentTables(page);

      await closeWithEscapeAndRestoreFocus(
        page,
        page.getByRole("button", {
          name: new RegExp(dashboardCopy.customMonthRange),
        }),
        dashboardCopy.monthRangeTitle,
      );
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    } finally {
      await removeTransactions(request, transactionIds);
    }
  });

  test("keeps movement entry and history reachable when zoomed", async ({
    page,
  }) => {
    await page.goto("/");
    await closeWithEscapeAndRestoreFocus(
      page,
      page.getByRole("button", { name: "Añadir movimiento" }),
      "Nuevo movimiento",
    );

    await seedHistoryRow(page, "Zoom historial E2E");
    await page.goto("/transactions?tab=all");
    await expectNoCriticalAxeViolations(page);
    // The zoomed viewport reflows to the stacked rows: the six-column table
    // would need more width than the shell leaves and would scroll the page.
    await expect(
      page.getByRole("list", { name: historyCopy.caption }),
    ).toBeVisible();
    await expect(page.locator('[data-history-layout="desktop"]')).toHaveCount(
      0,
    );
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const actions = page
      .getByRole("button", {
        name: historyCopy.actionsOf("Zoom historial E2E"),
      })
      .last();
    await actions.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNoCriticalAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();
    await expectVisibleFocusRing(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
