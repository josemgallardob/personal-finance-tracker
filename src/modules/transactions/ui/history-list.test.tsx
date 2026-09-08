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
  pageSize?: number;
  failNextPageOnce?: boolean;
  onMutate?: (
    method: string,
    path: string,
    body: unknown,
  ) => Promise<Response> | Response;
}): ReturnType<typeof vi.fn<FetchLike>> {
  const items = options?.items ?? [laterMovement, movement];
  let listAttempts = 0;
  let nextPageAttempts = 0;
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
      const dateFrom = params.get("dateFrom");
      const dateTo = params.get("dateTo");
      if (dateFrom) {
        listed = listed.filter((item) => item.date >= dateFrom);
      }
      if (dateTo) {
        listed = listed.filter((item) => item.date <= dateTo);
      }
      if (tagIds.length > 0) {
        listed = listed.filter((item) =>
          item.tagIds.some((tagId) => tagIds.includes(tagId)),
        );
      }
      const pageSize = options?.pageSize;
      if (pageSize !== undefined) {
        const cursor = params.get("cursor");
        const start = cursor === null || cursor === "" ? 0 : Number(cursor);
        if (cursor !== null) {
          nextPageAttempts += 1;
          if (options?.failNextPageOnce && nextPageAttempts === 1) {
            return Promise.reject(new TypeError("Failed to fetch"));
          }
        }
        const page = listed.slice(start, start + pageSize);
        const nextStart = start + pageSize;
        return jsonResponse(
          200,
          envelope({
            items: page,
            nextCursor: nextStart < listed.length ? String(nextStart) : null,
          }),
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
  }, 15_000);

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
  }, 15_000);

  it("combines an open dateFrom bound with type so only matching rows remain", async () => {
    const user = userEvent.setup();
    const fetchImpl = historyFetch();
    render(<ControlledHistory fetchImpl={fetchImpl} />);

    await screen.findByLabelText(historyCopy.searchLabel);
    await user.click(
      screen.getByRole("button", { name: historyCopy.dateRangeLabel }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: historyCopy.dateRangeTitle,
    });
    await user.type(
      within(dialog).getByLabelText(historyCopy.dateFromLabel),
      "03/08/2026",
    );
    await user.click(
      within(dialog).getByRole("button", { name: historyCopy.dateRangeApply }),
    );
    await user.selectOptions(
      screen.getByLabelText(historyCopy.typeLabel),
      "income",
    );

    expect(
      await screen.findByRole("rowheader", { name: "Nómina" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("rowheader", { name: "Supermercado" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        fetchImpl.mock.calls.some(([path]) => {
          const href = String(path);
          return (
            href.includes("dateFrom=2026-08-03") && href.includes("type=income")
          );
        }),
      ).toBe(true);
    });
  });

  it("keeps the date panel and stacked rows on a mobile viewport", async () => {
    stubViewport(false);
    const user = userEvent.setup();
    render(<ControlledHistory fetchImpl={historyFetch()} />);

    await screen.findByLabelText(historyCopy.searchLabel);
    await user.click(
      screen.getByRole("button", { name: historyCopy.dateRangeLabel }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-date-range-layout='mobile']")).not.toBe(
      null,
    );
    await user.click(
      within(dialog).getByRole("button", { name: historyCopy.dateRangeCancel }),
    );
    expect(
      await screen.findByRole("list", { name: historyCopy.caption }),
    ).toBeVisible();
  });

  it("appends cursor pages from Cargar más and shows the end of the list", async () => {
    const extra = Array.from({ length: 3 }, (_, index) => ({
      ...movement,
      id: `tx-page-${index}`,
      concept: `Página extra ${index}`,
      date: "2026-08-01",
      tagIds: [] as string[],
    }));
    const fetchImpl = historyFetch({
      items: [laterMovement, movement, ...extra],
      pageSize: 2,
    });
    const user = userEvent.setup();
    renderHistory(fetchImpl);

    expect(
      await screen.findByRole("rowheader", { name: "Nómina" }),
    ).toBeVisible();
    expect(
      screen.getByRole("rowheader", { name: "Supermercado" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("rowheader", { name: "Página extra 0" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: historyCopy.loadMore }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: historyCopy.loadMore }),
    );
    expect(
      await screen.findByRole("rowheader", { name: "Página extra 0" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: historyCopy.loadMore }),
    );
    expect(
      await screen.findByRole("rowheader", { name: "Página extra 2" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("status", { name: historyCopy.endOfList }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: historyCopy.loadMore }),
    ).not.toBeInTheDocument();
    const listGets = fetchImpl.mock.calls.filter(([path, init]) => {
      const href = String(path);
      const method = init.method ?? "GET";
      return (
        method === "GET" &&
        (href === "/api/transactions" || href.startsWith("/api/transactions?"))
      );
    });
    expect(listGets).toHaveLength(3);
  });

  it("loads the next page from the sentinel observer without duplicating the request", async () => {
    const observers: Array<{ callback: IntersectionObserverCallback }> = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        readonly callback: IntersectionObserverCallback;

        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
          observers.push({ callback });
        }

        disconnect() {}
        observe() {}
        takeRecords() {
          return [];
        }
        unobserve() {}
      },
    );
    const fetchImpl = historyFetch({
      items: [laterMovement, movement],
      pageSize: 1,
    });
    renderHistory(fetchImpl);
    expect(
      await screen.findByRole("rowheader", { name: "Nómina" }),
    ).toBeVisible();
    await screen.findByTestId("history-sentinel");
    const intersecting = [
      { isIntersecting: true },
    ] as IntersectionObserverEntry[];
    observers[0]?.callback(intersecting, observers[0] as never);
    observers[0]?.callback(intersecting, observers[0] as never);
    expect(
      await screen.findByRole("rowheader", { name: "Supermercado" }),
    ).toBeVisible();
    const listGets = fetchImpl.mock.calls.filter(([path, init]) => {
      const href = String(path);
      const method = init.method ?? "GET";
      return (
        method === "GET" &&
        (href === "/api/transactions" || href.startsWith("/api/transactions?"))
      );
    });
    expect(
      listGets.filter(([path]) => String(path).includes("cursor=")),
    ).toHaveLength(1);
    vi.unstubAllGlobals();
    stubViewport(true);
  });

  it("retries a failed later page without dropping the rows already shown", async () => {
    const fetchImpl = historyFetch({
      items: [laterMovement, movement],
      pageSize: 1,
      failNextPageOnce: true,
    });
    const user = userEvent.setup();
    renderHistory(fetchImpl);

    expect(
      await screen.findByRole("rowheader", { name: "Nómina" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: historyCopy.loadMore }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      historyCopy.pageErrorTitle,
    );
    expect(screen.getByRole("rowheader", { name: "Nómina" })).toBeVisible();
    expect(
      screen.queryByRole("rowheader", { name: "Supermercado" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: historyCopy.retry }));
    expect(
      await screen.findByRole("rowheader", { name: "Supermercado" }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets accumulated pages after an edit and after a filter change", async () => {
    const paged = [
      laterMovement,
      movement,
      { ...movement, id: "tx-3", concept: "Tercera", tagIds: [] },
    ];
    const fetchImpl = historyFetch({
      items: paged,
      pageSize: 1,
      onMutate: (method, path, body) => {
        if (method === "PUT") {
          return jsonResponse(
            200,
            envelope({
              ...movement,
              concept:
                typeof body === "object" &&
                body !== null &&
                "concept" in body &&
                typeof body.concept === "string"
                  ? body.concept
                  : "Editada",
            }),
          );
        }

        return jsonResponse(404, {
          error: {
            code: "notFound",
            message: "missing",
            requestId: "req-maintain",
          },
        });
      },
    });
    const user = userEvent.setup();
    render(<ControlledHistory fetchImpl={fetchImpl} />);

    expect(
      await screen.findByRole("rowheader", { name: "Nómina" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: historyCopy.loadMore }),
    );
    expect(
      await screen.findByRole("rowheader", { name: "Supermercado" }),
    ).toBeVisible();

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
    const dialog = await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.editTitle,
    });
    await user.clear(within(dialog).getByLabelText("Concepto"));
    await user.type(within(dialog).getByLabelText("Concepto"), "Editada");
    await user.click(
      within(dialog).getByRole("button", {
        name: transactionMaintenanceCopy.saveEdit,
      }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      await screen.findByRole("rowheader", { name: "Nómina" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("rowheader", { name: "Editada" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: historyCopy.loadMore }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: historyCopy.loadMore }),
    );
    expect(
      await screen.findByRole("rowheader", { name: "Editada" }),
    ).toBeVisible();

    await user.selectOptions(
      screen.getByLabelText(historyCopy.typeLabel),
      "income",
    );
    expect(
      await screen.findByRole("rowheader", { name: "Nómina" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("rowheader", { name: "Editada" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("status", { name: historyCopy.endOfList }),
    ).toBeVisible();
  });
});
