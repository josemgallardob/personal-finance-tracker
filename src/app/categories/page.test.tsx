/**
 * Categories route.
 *
 * The page is checked with the browser `fetch` replaced and nothing else, so
 * the assertion is that the route really wires the default adapter to the
 * documented endpoints of the current origin.
 */

import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FinancialDataProvider } from "../../shared/client/financial-data-provider";
import { REQUEST_ID_HEADER } from "../../shared/contracts/http";
import { classificationCopy } from "../../modules/classification/ui/classification-copy";
import CategoriesPage from "./page";

const REQUEST_ID = "req-categories-page";

function dataResponse(body: unknown): Response {
  return new Response(JSON.stringify({ data: body, requestId: REQUEST_ID }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CategoriesPage", () => {
  it("presents the catalog and the tags returned by the API", async () => {
    const fetchImpl = vi.fn((input: string) =>
      Promise.resolve(
        input.startsWith("/api/categories")
          ? dataResponse([
              {
                id: "seed-exp-alquiler",
                name: "Alquiler",
                type: "expense",
                isArchived: false,
              },
              {
                id: "seed-inc-sueldo",
                name: "Sueldo",
                type: "income",
                isArchived: false,
              },
            ])
          : dataResponse([
              { id: "tag-1", name: "Vacaciones", isArchived: true },
            ]),
      ),
    );

    vi.stubGlobal("fetch", fetchImpl);

    render(
      <FinancialDataProvider>
        <CategoriesPage />
      </FinancialDataProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Categorías", level: 1 }),
    ).toBeVisible();

    const expenses = await screen.findByRole("list", {
      name: classificationCopy.expenseTitle,
    });

    expect(within(expenses).getByText("Alquiler")).toBeVisible();
    expect(
      within(
        screen.getByRole("list", { name: classificationCopy.incomeTitle }),
      ).getByText("Sueldo"),
    ).toBeVisible();
    expect(screen.getByText("Vacaciones")).toBeVisible();
    expect(screen.getByText(classificationCopy.tagsArchivedNote)).toBeVisible();

    expect(fetchImpl.mock.calls.map((call) => call[0]).sort()).toEqual([
      "/api/categories?status=all",
      "/api/tags?status=all",
    ]);
  });

  it("keeps the page usable when the catalog cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    render(
      <FinancialDataProvider>
        <CategoriesPage />
      </FinancialDataProvider>,
    );

    const alerts = await screen.findAllByRole("alert");

    expect(alerts).toHaveLength(2);
    expect(
      screen.getByRole("button", {
        name: classificationCopy.categoriesRetryLabel,
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: classificationCopy.tagsRetryLabel }),
    ).toBeEnabled();
  });
});
