import { expect, test } from "@playwright/test";

import { demoCopy } from "../../src/modules/preferences/ui/demo-actions";
import { fillRequiredFields, openCreateDialog } from "./helpers";

async function enterDemo(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: demoCopy.enter }).click();
  await expect(
    page.getByRole("status", { name: demoCopy.banner }),
  ).toBeVisible();
}

test.describe("isolated demo experience", () => {
  test("shows demo state across pages and returns to the untouched personal movement", async ({
    page,
  }) => {
    await openCreateDialog(page);
    await fillRequiredFields(page, {
      amount: "17,40",
      category: "Alquiler",
      concept: "Movimiento personal conservado",
    });
    await page.getByRole("button", { name: "Añadir gasto" }).click();

    await enterDemo(page);
    await expect(
      page.getByText("Nómina", { exact: true }).first(),
    ).toBeVisible();

    for (const path of ["/", "/transactions?tab=all", "/categories"]) {
      await page.goto(path);
      await expect(
        page.getByRole("status", { name: demoCopy.banner }),
      ).toBeVisible();
    }

    await page.getByRole("button", { name: demoCopy.exit }).click();
    await expect(
      page.getByRole("button", { name: demoCopy.enter }),
    ).toBeVisible();
    await page.goto("/transactions?tab=all");
    await expect(
      page.getByText("Movimiento personal conservado"),
    ).toBeVisible();
    await expect(page.getByText("Nómina", { exact: true })).toHaveCount(0);
  });

  test("cancelled reset is inert and confirmed reset removes only added demo data", async ({
    page,
  }) => {
    await enterDemo(page);
    await openCreateDialog(page);
    await fillRequiredFields(page, {
      amount: "9,99",
      category: "Hogar",
      concept: "Cambio temporal de demo",
    });
    await page.getByRole("button", { name: "Añadir gasto" }).click();
    await page.goto("/transactions?tab=all");
    await expect(page.getByText("Cambio temporal de demo")).toBeVisible();

    await page.getByRole("button", { name: demoCopy.reset }).click();
    await expect(
      page.getByRole("dialog", { name: demoCopy.resetTitle }),
    ).toBeVisible();
    await page.getByRole("button", { name: demoCopy.resetCancel }).click();
    await expect(page.getByText("Cambio temporal de demo")).toBeVisible();

    await page.getByRole("button", { name: demoCopy.reset }).click();
    await page.getByRole("button", { name: demoCopy.resetConfirm }).click();
    await expect(
      page.getByRole("status", { name: demoCopy.banner }),
    ).toBeVisible();
    await page.goto("/transactions?tab=all");
    await expect(page.getByText("Cambio temporal de demo")).toHaveCount(0);
    await expect(
      page.getByText("Compra semanal", { exact: true }).first(),
    ).toBeVisible();
  });

  test("mode scoped visual selections and dashboard periods never cross modes", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      sessionStorage.setItem(
        "dashboard:period:personal",
        JSON.stringify({ kind: "previousMonth" }),
      );
      sessionStorage.setItem(
        "dashboard:series:categories:personal",
        JSON.stringify(["personal-only-category"]),
      );
    });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Mes anterior", pressed: true }),
    ).toBeVisible();

    await enterDemo(page);
    await expect(
      page.getByRole("button", { name: "Mes actual", pressed: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem("dashboard:period:demo")),
      )
      .toBeNull();
    await expect(
      page.getByRole("button", { name: /Categorías ·/ }).first(),
    ).toContainText("Categorías · 4");
  });
});
