import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { dashboardCopy } from "../../src/modules/analytics/ui/dashboard-copy";
import { classificationCopy } from "../../src/modules/classification/ui/classification-copy";
import { classificationFormCopy } from "../../src/modules/classification/ui/classification-form";
import { demoCopy } from "../../src/modules/preferences/ui/demo-actions";
import { historyCopy } from "../../src/modules/transactions/ui/history-copy";
import {
  expenseCategory,
  fillRequiredFields,
  openCreateDialog,
} from "./helpers";

async function expectNoCriticalAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter(
    (violation) => violation.impact === "critical",
  );

  expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
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
}

async function enterDemo(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: demoCopy.enter }).click();
  await expect(
    page.getByRole("status", { name: demoCopy.banner }),
  ).toBeVisible();
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test.describe("accessibility audit", () => {
  test("exposes equivalent tables for every dashboard chart without critical axe violations", async ({
    page,
  }) => {
    await enterDemo(page);
    await page
      .getByRole("button", { name: dashboardCopy.previousMonth })
      .click();
    await expectNoCriticalAxeViolations(page);

    for (const tableName of [
      dashboardCopy.comparisonTitle,
      dashboardCopy.trendCaption,
      dashboardCopy.categoryCaption,
      dashboardCopy.tagCaption,
    ]) {
      await expect(page.getByRole("table", { name: tableName })).toBeVisible();
    }

    for (const chartName of [
      "income-expense",
      "monthly-trend",
      "expense-by-category",
      "expense-by-tag",
    ]) {
      await expect(page.locator(`[data-chart="${chartName}"]`)).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
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

    await openCreateDialog(page);
    await fillRequiredFields(page, {
      amount: "12,50",
      category: expenseCategory,
      concept: "Accesibilidad E2E",
    });
    await page.getByRole("button", { name: "Añadir gasto" }).click();

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
    await page.getByRole("menuitem", { name: historyCopy.editAction }).click();
    const edit = page.getByRole("dialog", { name: "Editar movimiento" });
    await expect(edit).toBeVisible();
    await expectNoCriticalAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();
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
});
