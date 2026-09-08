import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { FinancialDataProvider } from "../../../shared/client/financial-data-provider";
import { emptyStateCopy } from "../../../shared/ui/empty-state";
import { HistoryList } from "./history-list";
import { historyCopy } from "./history-copy";
import { transactionMaintenanceCopy } from "./transaction-dialog-support";
import {
  categories,
  envelope,
  jsonResponse,
  movement,
  noContentResponse,
  preferences,
  tags,
} from "./transaction-dialog-fixtures";
import type { TransactionDto } from "../contracts/transaction";

const laterMovement: TransactionDto = {
  id: "tx-2",
  type: "income",
  amountMinor: 2000,
  date: "2026-08-03",
  categoryId: "cat-salary",
  concept: null,
  note: null,
  tagIds: [],
};

function stubViewport(isDesktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: isDesktop && query.includes("640px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

beforeEach(() => {
  stubViewport(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function historyFetch(options?: {
  items?: readonly TransactionDto[];
  failListOnce?: boolean;
  onMutate?: (
    method: string,
    path: string,
    body: unknown,
  ) => Promise<Response> | Response;
}): ReturnType<typeof vi.fn<FetchLike>> {
  const items = options?.items ?? [laterMovement, movement];
  let listAttempts = 0;
  const currentById = new Map(items.map((item) => [item.id, item]));

  return vi.fn<FetchLike>(async (path, init) => {
    const method = init.method ?? "GET";

    if (path.startsWith("/api/preferences")) {
      return jsonResponse(200, envelope(preferences));
    }
    if (path.startsWith("/api/categories")) {
      return jsonResponse(200, envelope(categories));
    }
    if (path.startsWith("/api/tags")) {
      return jsonResponse(200, envelope(tags));
    }
    if (path === "/api/transactions" && method === "GET") {
      listAttempts += 1;
      if (options?.failListOnce && listAttempts === 1) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return jsonResponse(
        200,
        envelope({ items: [...currentById.values()], nextCursor: null }),
      );
    }
    if (path.startsWith("/api/transactions/") && method === "GET") {
      const id = path.slice("/api/transactions/".length);
      const found = currentById.get(id);
      if (found === undefined) {
        return jsonResponse(404, {
          error: {
            code: "notFound",
            message: "missing",
            requestId: "req-maintain",
          },
        });
      }
      return jsonResponse(200, envelope(found));
    }
    if (options?.onMutate && method !== "GET") {
      const payload = init.body ? JSON.parse(String(init.body)) : null;
      const response = await options.onMutate(method, path, payload);
      if (method === "DELETE" && path.startsWith("/api/transactions/")) {
        currentById.delete(path.slice("/api/transactions/".length));
      }
      if (method === "PUT" && path.startsWith("/api/transactions/")) {
        const id = path.slice("/api/transactions/".length);
        const previous = currentById.get(id);
        if (previous) {
          currentById.set(id, {
            ...previous,
            type: payload.type ?? previous.type,
            amountMinor: payload.amountMinor ?? previous.amountMinor,
            date: payload.date ?? previous.date,
            categoryId: payload.categoryId ?? previous.categoryId,
            concept:
              payload.concept === undefined
                ? previous.concept
                : payload.concept,
            note: payload.note === undefined ? previous.note : payload.note,
          });
        }
      }
      if (method === "POST" && path === "/api/transactions") {
        currentById.set("tx-copy", {
          id: "tx-copy",
          type: payload.type ?? "expense",
          amountMinor: payload.amountMinor ?? 0,
          date: payload.date ?? preferences.today,
          categoryId: payload.categoryId ?? "cat-food",
          concept: payload.concept ?? null,
          note: payload.note ?? null,
          tagIds: [],
        });
      }
      return response;
    }
    if (path.startsWith("/api/transactions/") && method === "PUT") {
      return jsonResponse(200, envelope(movement));
    }
    if (path === "/api/transactions" && method === "POST") {
      return jsonResponse(
        201,
        envelope({ ...movement, id: "tx-copy", concept: "Copia" }),
      );
    }
    if (path.startsWith("/api/transactions/") && method === "DELETE") {
      currentById.delete(path.slice("/api/transactions/".length));
      return noContentResponse();
    }
    return jsonResponse(404, {
      error: {
        code: "notFound",
        message: "missing",
        requestId: "req-maintain",
      },
    });
  });
}

function renderHistory(fetchImpl: FetchLike) {
  return render(
    <FinancialDataProvider>
      <HistoryList client={createApiClient({ fetch: fetchImpl })} />
    </FinancialDataProvider>,
  );
}

function desktopTable() {
  return screen.getByRole("table", { name: historyCopy.caption });
}

describe("HistoryList", () => {
  it("paints the API order with signed amounts, tags and concept fallback", async () => {
    renderHistory(historyFetch());

    const table = await screen.findByRole("table", {
      name: historyCopy.caption,
    });
    const rowLabels = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getByRole("rowheader").textContent);

    expect(rowLabels).toEqual(["Nómina", "Supermercado"]);
    expect(within(table).getByText("Viajes")).toBeVisible();
    expect(within(table).getByText(historyCopy.noTags)).toBeVisible();
    expect(
      within(table).getByText((content) => content.includes("12,50")),
    ).toBeVisible();
    expect(
      within(table).getByText((content) => content.includes("20,00")),
    ).toBeVisible();
    expect(
      screen.queryByRole("list", { name: historyCopy.caption }),
    ).not.toBeInTheDocument();
  });

  it("uses stacked rows on a mobile viewport", async () => {
    stubViewport(false);
    renderHistory(historyFetch());

    const list = await screen.findByRole("list", {
      name: historyCopy.caption,
    });
    expect(
      within(list).getByRole("button", {
        name: historyCopy.actionsOf("Nómina"),
      }),
    ).toBeVisible();
    expect(
      within(list).getByRole("button", {
        name: historyCopy.actionsOf("Supermercado"),
      }),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the empty catalog copy when the first page has no movements", async () => {
    renderHistory(historyFetch({ items: [] }));

    expect(
      await screen.findByRole("region", {
        name: emptyStateCopy.noTransactions.title,
      }),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("retries after a network failure of the history page", async () => {
    const user = userEvent.setup();
    const fetchImpl = historyFetch({ failListOnce: true });
    renderHistory(fetchImpl);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      historyCopy.errorTitle,
    );

    await user.click(screen.getByRole("button", { name: historyCopy.retry }));

    expect(
      await screen.findByRole("table", { name: historyCopy.caption }),
    ).toBeVisible();
    expect(
      fetchImpl.mock.calls.filter((call) => call[0] === "/api/transactions"),
    ).toHaveLength(2);
  });

  it("opens edit, duplicate and delete dialogs for the chosen movement id", async () => {
    const user = userEvent.setup();
    const fetchImpl = historyFetch();
    renderHistory(fetchImpl);

    await screen.findByRole("table", { name: historyCopy.caption });

    await user.click(
      within(desktopTable()).getByRole("button", {
        name: historyCopy.actionsOf("Supermercado"),
      }),
    );
    await user.click(
      within(desktopTable()).getByRole("menuitem", {
        name: historyCopy.editAction,
      }),
    );

    expect(
      await screen.findByRole("dialog", {
        name: transactionMaintenanceCopy.editTitle,
      }),
    ).toBeVisible();
    expect(
      fetchImpl.mock.calls.some(
        (call) => call[0] === `/api/transactions/${movement.id}`,
      ),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await user.click(
      within(desktopTable()).getByRole("button", {
        name: historyCopy.actionsOf("Nómina"),
      }),
    );
    await user.click(
      within(desktopTable()).getByRole("menuitem", {
        name: historyCopy.duplicateAction,
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: transactionMaintenanceCopy.duplicateTitle,
      }),
    ).toBeVisible();
    expect(
      fetchImpl.mock.calls.some(
        (call) => call[0] === `/api/transactions/${laterMovement.id}`,
      ),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await user.click(
      within(desktopTable()).getByRole("button", {
        name: historyCopy.actionsOf("Supermercado"),
      }),
    );
    await user.click(
      within(desktopTable()).getByRole("menuitem", {
        name: historyCopy.deleteAction,
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: transactionMaintenanceCopy.deleteTitle,
      }),
    ).toBeVisible();
  });

  it("refreshes the list after edit, duplicate and delete succeed", async () => {
    const user = userEvent.setup();
    const fetchImpl = historyFetch({
      onMutate: (method) => {
        if (method === "DELETE") {
          return noContentResponse();
        }
        if (method === "POST") {
          return jsonResponse(
            201,
            envelope({ ...movement, id: "tx-copy", concept: "Copia" }),
          );
        }
        return jsonResponse(
          200,
          envelope({ ...movement, amountMinor: 1500, concept: "Editado" }),
        );
      },
    });
    renderHistory(fetchImpl);
    await screen.findByRole("table", { name: historyCopy.caption });

    await user.click(
      within(desktopTable()).getByRole("button", {
        name: historyCopy.actionsOf("Supermercado"),
      }),
    );
    await user.click(
      within(desktopTable()).getByRole("menuitem", {
        name: historyCopy.editAction,
      }),
    );
    const editDialog = await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.editTitle,
    });
    await user.clear(within(editDialog).getByLabelText("Concepto"));
    await user.type(within(editDialog).getByLabelText("Concepto"), "Editado");
    await user.click(
      within(editDialog).getByRole("button", {
        name: transactionMaintenanceCopy.saveEdit,
      }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      await within(desktopTable()).findByRole("rowheader", { name: "Editado" }),
    ).toBeVisible();

    await user.click(
      within(desktopTable()).getByRole("button", {
        name: historyCopy.actionsOf("Editado"),
      }),
    );
    await user.click(
      within(desktopTable()).getByRole("menuitem", {
        name: historyCopy.duplicateAction,
      }),
    );
    const duplicateDialog = await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.duplicateTitle,
    });
    await user.clear(within(duplicateDialog).getByLabelText("Concepto"));
    await user.type(
      within(duplicateDialog).getByLabelText("Concepto"),
      "Copia",
    );
    await user.click(
      within(duplicateDialog).getByRole("button", {
        name: transactionMaintenanceCopy.saveDuplicateExpense,
      }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      await within(desktopTable()).findByRole("rowheader", { name: "Copia" }),
    ).toBeVisible();

    await user.click(
      within(desktopTable()).getByRole("button", {
        name: historyCopy.actionsOf("Copia"),
      }),
    );
    await user.click(
      within(desktopTable()).getByRole("menuitem", {
        name: historyCopy.deleteAction,
      }),
    );
    const deleteDialog = await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.deleteTitle,
    });
    await user.click(
      within(deleteDialog).getByRole("button", {
        name: transactionMaintenanceCopy.deleteConfirm,
      }),
    );
    await waitFor(() => {
      expect(
        within(desktopTable()).queryByRole("rowheader", { name: "Copia" }),
      ).not.toBeInTheDocument();
    });
  });
});
