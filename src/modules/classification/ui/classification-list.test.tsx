/**
 * Category and tag management view.
 *
 * Only `fetch` is replaced: the real browser adapter, the envelope transport,
 * the contract validation and the resource lifecycle all run. That is what
 * makes these tests say something about the screen the owner will open, and
 * not about a hand-written stub of the catalog.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import { FinancialDataProvider } from "../../../shared/client/financial-data-provider";
import { createClassificationApi } from "../client/classification-api";
import {
  ClassificationList,
  groupCategoriesByType,
} from "./classification-list";
import {
  activeArchivedSummary,
  classificationCopy,
  classificationFailureCopy,
} from "./classification-copy";

const REQUEST_ID = "req-classification";

const expenseCategory = {
  id: "seed-exp-alquiler",
  name: "Alquiler",
  type: "expense" as const,
  isArchived: false,
};

const archivedExpenseCategory = {
  id: "seed-exp-tabaco",
  name: "Tabaco",
  type: "expense" as const,
  isArchived: true,
};

const incomeCategory = {
  id: "seed-inc-sueldo",
  name: "Sueldo",
  type: "income" as const,
  isArchived: false,
};

const activeTag = { id: "tag-1", name: "Vacaciones", isArchived: false };
const archivedTag = { id: "tag-2", name: "Navidad", isArchived: true };

function dataResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: body, requestId: REQUEST_ID }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return new Response(
    JSON.stringify({ error: { code, message, requestId: REQUEST_ID } }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        [REQUEST_ID_HEADER]: REQUEST_ID,
      },
    },
  );
}

/** Answers each collection from its own queue of responses, in order. */
function routedFetch(routes: {
  categories: (() => Response | Promise<never>)[];
  tags: (() => Response | Promise<never>)[];
}): ReturnType<typeof vi.fn<FetchLike>> {
  const remaining = {
    categories: [...routes.categories],
    tags: [...routes.tags],
  };

  return vi.fn<FetchLike>((input) => {
    const key = input.startsWith("/api/categories") ? "categories" : "tags";
    const next = remaining[key].shift() ?? routes[key][routes[key].length - 1];

    return Promise.resolve(next?.() as Response);
  });
}

function renderList(fetchImpl: FetchLike) {
  return render(
    <FinancialDataProvider>
      <ClassificationList
        api={createClassificationApi(createApiClient({ fetch: fetchImpl }))}
      />
    </FinancialDataProvider>,
  );
}

function categoriesRegion() {
  return screen.getByRole("region", {
    name: classificationCopy.categoriesTitle,
  });
}

function tagsRegion() {
  return screen.getByRole("region", { name: classificationCopy.tagsTitle });
}

describe("groupCategoriesByType", () => {
  it("keeps each immutable type in its own list and preserves order", () => {
    const grouped = groupCategoriesByType([
      incomeCategory,
      expenseCategory,
      archivedExpenseCategory,
    ]);

    expect(grouped.expense.map((item) => item.id)).toEqual([
      expenseCategory.id,
      archivedExpenseCategory.id,
    ]);
    expect(grouped.income.map((item) => item.id)).toEqual([incomeCategory.id]);
  });
});

describe("ClassificationList", () => {
  it("asks the documented endpoints for the complete catalog", async () => {
    const fetchImpl = routedFetch({
      categories: [() => dataResponse([expenseCategory])],
      tags: [() => dataResponse([activeTag])],
    });

    renderList(fetchImpl);

    await screen.findByText("Alquiler");

    const paths = fetchImpl.mock.calls.map((call) => call[0]);

    expect(paths).toContain("/api/categories?status=all");
    expect(paths).toContain("/api/tags?status=all");
  });

  it("announces both collections while they load", async () => {
    let releaseCategories!: (response: Response) => void;
    const fetchImpl = vi.fn<FetchLike>((input) =>
      input.startsWith("/api/categories")
        ? new Promise<Response>((resolve) => {
            releaseCategories = resolve;
          })
        : Promise.resolve(dataResponse([activeTag])),
    );

    renderList(fetchImpl);

    expect(within(categoriesRegion()).getByRole("status")).toHaveTextContent(
      classificationCopy.categoriesLoading,
    );
    expect(within(categoriesRegion()).getByRole("status")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(within(tagsRegion()).getByRole("status")).toHaveTextContent(
      classificationCopy.tagsLoading,
    );

    await screen.findByText("Vacaciones");

    expect(within(tagsRegion()).queryByRole("status")).not.toBeInTheDocument();
    expect(within(categoriesRegion()).getByRole("status")).toBeVisible();

    releaseCategories(dataResponse([expenseCategory]));

    await screen.findByText("Alquiler");
    expect(
      within(categoriesRegion()).queryByRole("status"),
    ).not.toBeInTheDocument();
  });

  it("separates expense and income categories and never mixes the types", async () => {
    renderList(
      routedFetch({
        categories: [
          () =>
            dataResponse([
              expenseCategory,
              archivedExpenseCategory,
              incomeCategory,
            ]),
        ],
        tags: [() => dataResponse([activeTag])],
      }),
    );

    const expenses = await screen.findByRole("list", {
      name: classificationCopy.expenseTitle,
    });
    const incomes = screen.getByRole("list", {
      name: classificationCopy.incomeTitle,
    });

    expect(within(expenses).getAllByRole("listitem")).toHaveLength(2);
    expect(within(expenses).getByText("Alquiler")).toBeVisible();
    expect(within(expenses).getByText("Tabaco")).toBeVisible();
    expect(within(expenses).queryByText("Sueldo")).not.toBeInTheDocument();

    expect(within(incomes).getAllByRole("listitem")).toHaveLength(1);
    expect(within(incomes).getByText("Sueldo")).toBeVisible();
    expect(within(incomes).queryByText("Alquiler")).not.toBeInTheDocument();
  });

  it("marks archived rows as text and explains that the history is kept", async () => {
    renderList(
      routedFetch({
        categories: [
          () => dataResponse([expenseCategory, archivedExpenseCategory]),
        ],
        tags: [() => dataResponse([activeTag, archivedTag])],
      }),
    );

    const expenses = await screen.findByRole("list", {
      name: classificationCopy.expenseTitle,
    });
    const archivedRow = within(expenses)
      .getByText("Tabaco")
      .closest("li") as HTMLElement;
    const activeRow = within(expenses)
      .getByText("Alquiler")
      .closest("li") as HTMLElement;

    expect(
      within(archivedRow).getByText(classificationCopy.archivedBadge),
    ).toBeVisible();
    expect(
      within(activeRow).queryByText(classificationCopy.archivedBadge),
    ).not.toBeInTheDocument();

    expect(
      within(categoriesRegion()).getByText(
        classificationCopy.categoriesArchivedNote,
      ),
    ).toBeVisible();
    expect(
      within(tagsRegion()).getByText(classificationCopy.tagsArchivedNote),
    ).toBeVisible();
    expect(
      within(categoriesRegion()).getByText(activeArchivedSummary(1, 1)),
    ).toBeVisible();
    expect(
      within(tagsRegion()).getByText(activeArchivedSummary(1, 1)),
    ).toBeVisible();
  });

  it("omits the archival note when nothing is archived", async () => {
    renderList(
      routedFetch({
        categories: [() => dataResponse([expenseCategory])],
        tags: [() => dataResponse([activeTag])],
      }),
    );

    await screen.findByText("Alquiler");

    expect(
      screen.queryByText(classificationCopy.categoriesArchivedNote),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(classificationCopy.tagsArchivedNote),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(classificationCopy.archivedBadge),
    ).not.toBeInTheDocument();
  });

  it("keeps both type sections when only one of them has categories", async () => {
    renderList(
      routedFetch({
        categories: [() => dataResponse([incomeCategory])],
        tags: [() => dataResponse([activeTag])],
      }),
    );

    await screen.findByText("Sueldo");

    expect(screen.getByText(classificationCopy.expenseEmpty)).toBeVisible();
    expect(
      screen.queryByRole("list", { name: classificationCopy.expenseTitle }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: classificationCopy.incomeTitle }),
    ).toBeVisible();
  });

  it("offers the empty state of each collection independently", async () => {
    renderList(
      routedFetch({
        categories: [() => dataResponse([])],
        tags: [() => dataResponse([])],
      }),
    );

    expect(
      await screen.findByRole("region", {
        name: classificationCopy.categoriesEmptyTitle,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: classificationCopy.tagsEmptyTitle }),
    ).toBeVisible();
    expect(
      screen.getByText(classificationCopy.categoriesEmptyDescription),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: classificationCopy.expenseTitle }),
    ).not.toBeInTheDocument();
  });

  it("treats an accepted answer without a representation as an empty catalog", async () => {
    const noContent = () =>
      new Response(null, {
        status: 204,
        headers: { [REQUEST_ID_HEADER]: REQUEST_ID },
      });

    renderList(routedFetch({ categories: [noContent], tags: [noContent] }));

    expect(
      await screen.findByRole("region", {
        name: classificationCopy.categoriesEmptyTitle,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: classificationCopy.tagsEmptyTitle }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the Spanish refusal of the server and recovers on retry", async () => {
    const user = userEvent.setup();
    const fetchImpl = routedFetch({
      categories: [
        () =>
          errorResponse(
            503,
            "serviceUnavailable",
            "El servicio no está disponible en este momento.",
          ),
        () => dataResponse([expenseCategory]),
      ],
      tags: [() => dataResponse([activeTag])],
    });

    renderList(fetchImpl);

    const alert = await screen.findByRole("alert");

    expect(
      within(alert).getByText(classificationCopy.categoriesErrorTitle),
    ).toBeVisible();
    expect(
      within(alert).getByText(
        "El servicio no está disponible en este momento.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Vacaciones")).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: classificationCopy.categoriesRetryLabel,
      }),
    );

    expect(await screen.findByText("Alquiler")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains a load that never reached the application and retries only that collection", async () => {
    const user = userEvent.setup();
    const fetchImpl = routedFetch({
      categories: [() => dataResponse([expenseCategory])],
      tags: [
        () => Promise.reject(new TypeError("Failed to fetch")),
        () => dataResponse([activeTag]),
      ],
    });

    renderList(fetchImpl);

    const alert = await screen.findByRole("alert");

    expect(
      within(alert).getByText(classificationCopy.tagsErrorTitle),
    ).toBeVisible();
    expect(
      within(alert).getByText(classificationFailureCopy.network),
    ).toBeVisible();

    const categoryRequestsBefore = fetchImpl.mock.calls.filter((call) =>
      call[0].startsWith("/api/categories"),
    ).length;

    await user.click(
      screen.getByRole("button", { name: classificationCopy.tagsRetryLabel }),
    );

    expect(await screen.findByText("Vacaciones")).toBeVisible();
    expect(
      fetchImpl.mock.calls.filter((call) =>
        call[0].startsWith("/api/categories"),
      ),
    ).toHaveLength(categoryRequestsBefore);
  });

  it("refuses a payload that is not the documented contract", async () => {
    renderList(
      routedFetch({
        categories: [() => dataResponse([{ id: "cat-1", name: "Alquiler" }])],
        tags: [() => dataResponse([activeTag])],
      }),
    );

    const alert = await screen.findByRole("alert");

    expect(
      within(alert).getByText(classificationFailureCopy.invalidResponse),
    ).toBeVisible();
    expect(screen.queryByText("Alquiler")).not.toBeInTheDocument();
  });

  it("keeps the same accessible structure and keyboard order at mobile and desktop widths", async () => {
    const user = userEvent.setup();
    const fetchImpl = routedFetch({
      categories: [
        () =>
          errorResponse(
            500,
            "internalError",
            "Se ha producido un error inesperado.",
          ),
      ],
      tags: [() => dataResponse([activeTag, archivedTag])],
    });

    const setViewport = (width: number) => {
      window.innerWidth = width;
      window.dispatchEvent(new Event("resize"));
    };

    setViewport(320);
    renderList(fetchImpl);

    const readStructure = () => ({
      headings: screen
        .getAllByRole("heading")
        .map((heading) => `${heading.tagName}:${heading.textContent ?? ""}`),
      buttons: screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
      tags: within(tagsRegion())
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    });

    await screen.findByRole("alert");
    const mobile = readStructure();

    setViewport(1280);
    await waitFor(() => {
      expect(readStructure()).toEqual(mobile);
    });

    expect(mobile.headings).toEqual([
      `H2:${classificationCopy.categoriesTitle}`,
      `H2:${classificationCopy.tagsTitle}`,
    ]);
    expect(mobile.buttons).toEqual([classificationCopy.categoriesRetryLabel]);
    expect(mobile.tags).toEqual([
      "Vacaciones",
      `Navidad${classificationCopy.archivedBadge}`,
    ]);

    await user.tab();
    expect(
      screen.getByRole("button", {
        name: classificationCopy.categoriesRetryLabel,
      }),
    ).toHaveFocus();
  });
});
