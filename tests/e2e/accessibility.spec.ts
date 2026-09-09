import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { dashboardCopy } from "../../src/modules/analytics/ui/dashboard-copy";
import { classificationCopy } from "../../src/modules/classification/ui/classification-copy";
import { classificationFormCopy } from "../../src/modules/classification/ui/classification-form";
import { demoCopy } from "../../src/modules/preferences/ui/demo-actions";
import { recurringCopy } from "../../src/modules/recurring/ui/recurring-copy";
import { historyCopy } from "../../src/modules/transactions/ui/history-copy";
import {
  expenseCategory,
  fillRequiredFields,
  openCreateDialog,
} from "./helpers";

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

/**
 * Enters the demo from the keyboard.
 *
 * The audit never uses the pointer: a browser only paints the focus ring for
 * an interaction it considers keyboard-driven, so a single click earlier in
 * the flow would hide a missing ring instead of exposing it.
 */
async function enterDemo(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: demoCopy.enter }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status", { name: demoCopy.banner }),
  ).toBeVisible();
}

/** Demo dashboard on the previous month, the period that paints every chart. */
async function openFullDashboard(page: Page): Promise<void> {
  await enterDemo(page);
  await page.getByRole("button", { name: dashboardCopy.previousMonth }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("table", { name: dashboardCopy.averageTagCaption }),
  ).toBeVisible();
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
  }) => {
    await openFullDashboard(page);
    await expectNoCriticalAxeViolations(page);
    await expectChartsHaveEquivalentTables(page);
  });

  test("opens dashboard dialogs by keyboard and restores the trigger focus", async ({
    page,
  }) => {
    await enterDemo(page);

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
  }) => {
    await enterDemo(page);
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
    await enterDemo(page);
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
  }) => {
    await openFullDashboard(page);
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
