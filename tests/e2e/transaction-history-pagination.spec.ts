import { expect, test, type Page } from "@playwright/test";

import { transactionMaintenanceCopy } from "../../src/modules/transactions/ui/transaction-dialog-support";
import { historyCopy } from "../../src/modules/transactions/ui/history-copy";
import {
  goToHistory,
  openHistoryActions,
  seedTiedHistoryExpenses,
} from "./helpers";

async function clickLoadMore(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: historyCopy.loadMore })
    .evaluate((button) => {
      if (button instanceof HTMLButtonElement) {
        button.click();
      }
    });
}

const conceptPrefix = "Paginación E2E";
const editedConcept = "Paginación E2E editada";

test.describe("movement history pagination", () => {
  test("walks tied-date pages once, then resets after an edit", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await goToHistory(page);
    await seedTiedHistoryExpenses(page.request, {
      conceptPrefix,
      count: 65,
    });
    await page.goto(
      `/transactions?tab=all&q=${encodeURIComponent(conceptPrefix)}`,
    );

    const table = page.getByRole("table", { name: historyCopy.caption });
    await expect(
      table.getByRole("rowheader", { name: `${conceptPrefix} 64` }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(table.getByRole("rowheader")).toHaveCount(30);

    await clickLoadMore(page);
    await expect(table.getByRole("rowheader")).toHaveCount(60);
    await clickLoadMore(page);
    await expect(table.getByRole("rowheader")).toHaveCount(65);
    await expect(
      page.getByRole("button", { name: historyCopy.loadMore }),
    ).toHaveCount(0);
    await expect(page.getByText(historyCopy.endOfList)).toBeVisible();

    const labels = await table.getByRole("rowheader").allTextContents();
    expect(new Set(labels).size).toBe(65);

    await openHistoryActions(page, `${conceptPrefix} 10`);
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

    await expect(table.getByRole("rowheader")).toHaveCount(30);
    await expect(
      table.getByRole("rowheader", { name: editedConcept }),
    ).toHaveCount(0);
    await clickLoadMore(page);
    await expect(
      table.getByRole("rowheader", { name: editedConcept }),
    ).toBeVisible();
  });
});
