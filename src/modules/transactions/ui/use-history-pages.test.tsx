/**
 * Cursor pagination of the history: one in-flight page, id deduplication,
 * abort on filter or revision, and a retry that does not drop painted rows.
 *
 * `loadPage` is the real boundary. IntersectionObserver is replaced only when
 * a test needs to fire a synthetic intersection.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClientResult } from "../../../shared/client/api-client";
import type {
  TransactionCursorPageDto,
  TransactionDto,
} from "../contracts/transaction";
import {
  mergeHistoryItems,
  useHistoryPages,
  type HistoryPageLoader,
} from "./use-history-pages";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function movement(id: string, concept: string): TransactionDto {
  return {
    id,
    type: "expense",
    amountMinor: 100,
    date: "2026-08-01",
    categoryId: "cat-food",
    concept,
    note: null,
    tagIds: [],
  };
}

function tiedPage(start: number, count: number): readonly TransactionDto[] {
  return Array.from({ length: count }, (_, index) => {
    const n = start + index;
    return movement(`tx-${String(n).padStart(2, "0")}`, `Empate ${n}`);
  });
}

function okPage(
  items: readonly TransactionDto[],
  nextCursor: string | null,
): ApiClientResult<TransactionCursorPageDto> {
  return {
    ok: true,
    noContent: false,
    status: 200,
    requestId: "req-page",
    data: { items, nextCursor },
  };
}

const networkError: ApiClientResult<TransactionCursorPageDto> = {
  ok: false,
  reason: "network",
};

function idsFromScreen(): string[] {
  const text = screen.getByText(/^ids:/).textContent ?? "ids:";
  const raw = text.slice("ids:".length);
  return raw === "ninguno" || raw === "" ? [] : raw.split(",");
}

interface ProbeProps {
  readonly requestKey?: string;
  readonly revision?: number;
  readonly refreshEpoch?: number;
  readonly loadPage: HistoryPageLoader;
}

function PagesProbe({
  requestKey = "all",
  revision = 0,
  refreshEpoch = 0,
  loadPage,
}: ProbeProps) {
  const pages = useHistoryPages({
    loadPage,
    requestKey,
    revision,
    refreshEpoch,
  });

  return (
    <div>
      <p>estado:{pages.status}</p>
      <p>ids:{pages.items.map((item) => item.id).join(",") || "ninguno"}</p>
      <p>mas:{pages.hasMore ? "si" : "no"}</p>
      <p>fin:{pages.endReached ? "si" : "no"}</p>
      <p>cargando:{pages.isLoadingMore ? "si" : "no"}</p>
      <p>errorPagina:{pages.pageError?.reason ?? "ninguno"}</p>
      <button type="button" onClick={pages.loadMore}>
        Cargar más
      </button>
      <button type="button" onClick={pages.retryPage}>
        Reintentar
      </button>
    </div>
  );
}

function ControlledPages({
  loadPage,
}: {
  readonly loadPage: HistoryPageLoader;
}) {
  const [requestKey, setRequestKey] = useState("all");
  const [revision, setRevision] = useState(0);

  return (
    <div>
      <button type="button" onClick={() => setRequestKey("expense")}>
        Filtrar
      </button>
      <button
        type="button"
        onClick={() => setRevision((current) => current + 1)}
      >
        Mutar
      </button>
      <PagesProbe
        loadPage={loadPage}
        requestKey={requestKey}
        revision={revision}
      />
    </div>
  );
}

describe("mergeHistoryItems", () => {
  it("keeps the first occurrence of a repeated identifier", () => {
    const first = movement("tx-1", "Uno");
    const duplicate = movement("tx-1", "Otro");
    const second = movement("tx-2", "Dos");

    expect(mergeHistoryItems([], [first, duplicate, second])).toEqual([
      first,
      second,
    ]);
    expect(mergeHistoryItems([first], [duplicate, second])).toEqual([
      first,
      second,
    ]);
    expect(mergeHistoryItems([first, second], [])).toEqual([first, second]);
  });
});

describe("useHistoryPages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks sixty tied-date rows once through the load-more fallback", async () => {
    const loads: Array<string | undefined> = [];
    const loadPage: HistoryPageLoader = async (cursor) => {
      loads.push(cursor);

      if (cursor === undefined) {
        return okPage(tiedPage(0, 30), "c1");
      }

      if (cursor === "c1") {
        return okPage([tiedPage(29, 1)[0], ...tiedPage(30, 29)], "c2");
      }

      return okPage(tiedPage(59, 6), null);
    };
    const user = userEvent.setup();
    render(<PagesProbe loadPage={loadPage} />);

    await waitFor(() => {
      expect(idsFromScreen()).toHaveLength(30);
    });

    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => {
      expect(idsFromScreen()).toHaveLength(59);
    });

    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => {
      expect(idsFromScreen()).toHaveLength(65);
    });
    expect(screen.getByText("fin:si")).toBeVisible();
    expect(loads).toEqual([undefined, "c1", "c2"]);
    expect(new Set(idsFromScreen()).size).toBe(65);
  });

  it("ignores concurrent Cargar más presses while a later page is in flight", async () => {
    const second = deferred<ApiClientResult<TransactionCursorPageDto>>();
    let secondStarts = 0;
    const loadPage: HistoryPageLoader = async (cursor) => {
      if (cursor === undefined) {
        return okPage(tiedPage(0, 2), "c1");
      }

      secondStarts += 1;
      return second.promise;
    };
    const user = userEvent.setup();
    render(<PagesProbe loadPage={loadPage} />);
    expect(await screen.findByText(/^ids:/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    await user.click(screen.getByRole("button", { name: "Cargar más" }));

    await waitFor(() => {
      expect(secondStarts).toBe(1);
    });
    second.resolve(okPage(tiedPage(2, 2), null));
    await waitFor(() => {
      expect(screen.getByText("fin:si")).toBeVisible();
    });
    expect(idsFromScreen()).toHaveLength(4);
  });

  it("still loads through Cargar más when IntersectionObserver is missing", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const loadPage: HistoryPageLoader = async (cursor) =>
      cursor === undefined
        ? okPage([movement("tx-1", "Uno")], "c1")
        : okPage([movement("tx-2", "Dos")], null);
    const user = userEvent.setup();
    render(<PagesProbe loadPage={loadPage} />);

    expect(await screen.findByText("ids:tx-1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("ids:tx-1,tx-2")).toBeVisible();
    expect(screen.getByText("fin:si")).toBeVisible();
  });

  it("keeps the first page and retries the failed cursor", async () => {
    let secondAttempts = 0;
    const loadPage: HistoryPageLoader = async (cursor) => {
      if (cursor === undefined) {
        return okPage([movement("tx-1", "Uno")], "c1");
      }

      secondAttempts += 1;
      if (secondAttempts === 1) {
        return networkError;
      }

      return okPage([movement("tx-2", "Dos")], null);
    };
    const user = userEvent.setup();
    render(<PagesProbe loadPage={loadPage} />);

    expect(await screen.findByText("ids:tx-1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("errorPagina:network")).toBeVisible();
    expect(screen.getByText("ids:tx-1")).toBeVisible();
    expect(screen.getByText("mas:no")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("ids:tx-1,tx-2")).toBeVisible();
    expect(screen.getByText("errorPagina:ninguno")).toBeVisible();
    expect(secondAttempts).toBe(2);
  });

  it("aborts an in-flight later page when the filter identity changes", async () => {
    const second = deferred<ApiClientResult<TransactionCursorPageDto>>();
    const signals: AbortSignal[] = [];

    function FilterProbe() {
      const [requestKey, setRequestKey] = useState("all");
      const pages = useHistoryPages({
        requestKey,
        revision: 0,
        refreshEpoch: 0,
        loadPage: (cursor, signal) => {
          if (requestKey === "expense") {
            return Promise.resolve(okPage([movement("tx-exp", "Gasto")], null));
          }

          if (cursor === undefined) {
            return Promise.resolve(
              okPage(
                [movement("tx-all", "Todos"), movement("tx-exp", "Gasto")],
                "c1",
              ),
            );
          }

          signals.push(signal);
          return second.promise;
        },
      });

      return (
        <div>
          <p>ids:{pages.items.map((item) => item.id).join(",")}</p>
          <button type="button" onClick={() => setRequestKey("expense")}>
            Filtrar
          </button>
          <button type="button" onClick={pages.loadMore}>
            Cargar más
          </button>
        </div>
      );
    }

    const user = userEvent.setup();
    render(<FilterProbe />);
    expect(await screen.findByText("ids:tx-all,tx-exp")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => {
      expect(signals).toHaveLength(1);
    });
    await user.click(screen.getByRole("button", { name: "Filtrar" }));
    expect(await screen.findByText("ids:tx-exp")).toBeVisible();
    expect(signals[0]?.aborted).toBe(true);
    second.resolve(okPage([movement("tx-late", "Tarde")], null));
    await waitFor(() => {
      expect(screen.queryByText(/tx-late/)).not.toBeInTheDocument();
    });
  });

  it("drops accumulated pages when the mutation revision changes", async () => {
    let revisionLoads = 0;
    const loadPage: HistoryPageLoader = async (cursor) => {
      if (cursor === undefined) {
        revisionLoads += 1;
        return okPage(
          [movement("tx-1", "Uno"), movement("tx-rev", `Rev ${revisionLoads}`)],
          "c1",
        );
      }

      return okPage([movement("tx-2", "Dos")], null);
    };
    const user = userEvent.setup();
    render(<ControlledPages loadPage={loadPage} />);

    expect(await screen.findByText(/ids:tx-1,tx-rev/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText(/tx-2/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Mutar" }));
    await waitFor(() => {
      expect(screen.getByText(/^ids:/).textContent).toContain("tx-rev");
      expect(screen.getByText(/^ids:/).textContent).not.toContain("tx-2");
    });
    expect(revisionLoads).toBe(2);
  });

  it("ignores an aborted later-page result and a thrown load", async () => {
    let attempt = 0;
    const loadPage: HistoryPageLoader = async (cursor) => {
      if (cursor === undefined) {
        return okPage([movement("tx-1", "Uno")], "c1");
      }

      attempt += 1;
      if (attempt === 1) {
        return { ok: false, reason: "aborted" };
      }

      throw new TypeError("Failed to fetch");
    };
    const user = userEvent.setup();
    render(<PagesProbe loadPage={loadPage} />);
    expect(await screen.findByText("ids:tx-1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => {
      expect(attempt).toBe(1);
    });
    expect(screen.getByText("errorPagina:ninguno")).toBeVisible();
    expect(screen.getByText("ids:tx-1")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("errorPagina:network")).toBeVisible();
  });

  it("treats a no-content later page as the end of the sequence", async () => {
    const loadPage: HistoryPageLoader = async (cursor) => {
      if (cursor === undefined) {
        return okPage([movement("tx-1", "Uno")], "c1");
      }

      return {
        ok: true,
        noContent: true,
        status: 204,
        requestId: "req-empty",
      };
    };
    const user = userEvent.setup();
    render(<PagesProbe loadPage={loadPage} />);
    expect(await screen.findByText("ids:tx-1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("fin:si")).toBeVisible();
  });
});
