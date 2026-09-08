import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/transactions",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=all"),
}));

import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { FinancialDataProvider } from "../../../shared/client/financial-data-provider";
import { emptyStateCopy } from "../../../shared/ui/empty-state";
import {
  emptyHistoryQueryState,
  HISTORY_SEARCH_DEBOUNCE_MS,
  type HistoryQueryState,
} from "../client/history-query-state";
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
  vi.useRealTimers();
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
    if (
      (path === "/api/transactions" || path.startsWith("/api/transactions?")) &&
      method === "GET"
    ) {
      listAttempts += 1;
      if (options?.failListOnce && listAttempts === 1) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      const params = new URL(path, "http://localhost").searchParams;
      const q = params.get("q")?.trim().toLowerCase() ?? "";
      const type = params.get("type");
      const categoryId = params.get("categoryId");
      const tagIds = params.getAll("tagId").filter((tagId) => tagId !== "");
      let listed = [...currentById.values()];
      if (q !== "") {
        listed = listed.filter((item) => {
          const concept = (item.concept ?? "").toLowerCase();
          const note = (item.note ?? "").toLowerCase();
          return concept.includes(q) || note.includes(q);
        });
      }
      if (type === "expense" || type === "income") {
        listed = listed.filter((item) => item.type === type);
      }
      if (categoryId) {
        listed = listed.filter((item) => item.categoryId === categoryId);
      }
      if (tagIds.length > 0) {
        listed = listed.filter((item) =>
          item.tagIds.some((tagId) => tagIds.includes(tagId)),
        );
      }
      return jsonResponse(200, envelope({ items: listed, nextCursor: null }));
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

function ControlledHistory({
  fetchImpl,
  initial = emptyHistoryQueryState,
}: {
  readonly fetchImpl: FetchLike;
  readonly initial?: HistoryQueryState;
}) {
  const [state, setState] = useState(initial);
  return (
    <FinancialDataProvider>
      <HistoryList
        client={createApiClient({ fetch: fetchImpl })}
        onQueryStateChange={setState}
        queryState={state}
      />
    </FinancialDataProvider>
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
  }, 15_000);

  it("shows a distinct no-results state when filters match nothing", async () => {
    render(
      <FinancialDataProvider>
        <HistoryList
          client={createApiClient({ fetch: historyFetch({ items: [] }) })}
          onQueryStateChange={vi.fn()}
          queryState={{ ...emptyHistoryQueryState, q: "zzz" }}
        />
      </FinancialDataProvider>,
    );

    expect(
      await screen.findByRole("region", {
        name: emptyStateCopy.noResults.title,
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", {
        name: emptyStateCopy.noTransactions.title,
      }),
    ).not.toBeInTheDocument();
  });

  it("debounces search, combines filters without duplicate tags, and encodes the list URL", async () => {
    const fetchImpl = historyFetch();
    render(<ControlledHistory fetchImpl={fetchImpl} />);

    await screen.findByLabelText(historyCopy.searchLabel);
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText(historyCopy.searchLabel), {
      target: { value: "Café & té" },
    });
    expect(
      fetchImpl.mock.calls.some(([path]) => String(path).includes("q=Caf")),
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(HISTORY_SEARCH_DEBOUNCE_MS);
    vi.useRealTimers();
    await waitFor(() => {
      expect(
        fetchImpl.mock.calls.some(
          ([path]) =>
            String(path) === "/api/transactions?q=Caf%C3%A9%20%26%20t%C3%A9",
        ),
      ).toBe(true);
    });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: historyCopy.clearFilters }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: historyCopy.clearFilters }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(historyCopy.searchLabel)).toHaveValue("");

    await user.selectOptions(
      screen.getByLabelText(historyCopy.typeLabel),
      "expense",
    );
    await user.selectOptions(
      screen.getByLabelText(historyCopy.categoryLabel),
      "cat-food",
    );
    await user.click(screen.getByRole("button", { name: /Etiquetas · 0/ }));
    await user.click(screen.getByRole("checkbox", { name: "Viajes" }));
    await user.click(screen.getByRole("checkbox", { name: "Viajes" }));
    await user.click(screen.getByRole("checkbox", { name: "Viajes" }));
    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    await waitFor(() => {
      expect(
        fetchImpl.mock.calls.some(([path]) => {
          const href = String(path);
          return (
            href.includes("type=expense") &&
            href.includes("categoryId=cat-food") &&
            href.includes("tagId=tag-trips") &&
            !href.includes("q=") &&
            !href.includes("tagId=tag-trips&tagId=tag-trips")
          );
        }),
      ).toBe(true);
    });

    expect(
      await screen.findByRole("rowheader", { name: "Supermercado" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("rowheader", { name: "Nómina" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: historyCopy.clearFilters }),
    );
    expect(
      await screen.findByRole("rowheader", { name: "Nómina" }),
    ).toBeVisible();
  });

  it("discards a slower page from the previous filter set", async () => {
    let releaseFirst: ((value: Response) => void) | undefined;
    const firstPage = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchImpl = vi.fn<FetchLike>(async (path, init) => {
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
      if (
        (path === "/api/transactions" ||
          path.startsWith("/api/transactions?")) &&
        method === "GET"
      ) {
        if (String(path).includes("type=expense")) {
          return jsonResponse(
            200,
            envelope({ items: [movement], nextCursor: null }),
          );
        }

        return firstPage;
      }

      return jsonResponse(404, {
        error: {
          code: "notFound",
          message: "missing",
          requestId: "req-maintain",
        },
      });
    });
    const user = userEvent.setup();
    render(<ControlledHistory fetchImpl={fetchImpl} />);

    await screen.findByLabelText(historyCopy.searchLabel);
    await user.selectOptions(
      screen.getByLabelText(historyCopy.typeLabel),
      "expense",
    );
    expect(
      await screen.findByRole("rowheader", { name: "Supermercado" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("rowheader", { name: "Nómina" }),
    ).not.toBeInTheDocument();

    releaseFirst?.(
      jsonResponse(
        200,
        envelope({ items: [laterMovement, movement], nextCursor: null }),
      ),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("rowheader", { name: "Nómina" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("rowheader", { name: "Supermercado" }),
    ).toBeVisible();
  });
});
