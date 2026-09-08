import { describe, expect, it, vi } from "vitest";

import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import { loadHistorySnapshot } from "./history-load";

const REQUEST_ID = "req-history-load";

const page = {
  items: [
    {
      id: "tx-1",
      type: "expense",
      amountMinor: 1250,
      date: "2026-08-02",
      categoryId: "cat-food",
      concept: "Pan",
      note: null,
      tagIds: ["tag-trips"],
    },
  ],
  nextCursor: "cursor-1",
};

const categories = [
  { id: "cat-food", name: "Alimentación", type: "expense", isArchived: false },
];
const tags = [{ id: "tag-trips", name: "Viajes", isArchived: false }];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  });
}

function envelope(data: unknown) {
  return { data, requestId: REQUEST_ID };
}

describe("loadHistorySnapshot", () => {
  it("returns the first page together with catalogs on success", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path.startsWith("/api/transactions")) {
        return jsonResponse(200, envelope(page));
      }
      if (path.startsWith("/api/categories")) {
        return jsonResponse(200, envelope(categories));
      }
      return jsonResponse(200, envelope(tags));
    });

    const result = await loadHistorySnapshot(
      createApiClient({ fetch: fetchImpl }),
      new AbortController().signal,
    );

    expect(result).toEqual({
      ok: true,
      noContent: false,
      status: 200,
      requestId: REQUEST_ID,
      data: {
        items: page.items,
        nextCursor: "cursor-1",
        categories,
        tags,
      },
    });
    expect(fetchImpl.mock.calls.map((call) => call[0]).sort()).toEqual([
      "/api/categories?status=all",
      "/api/tags?status=all",
      "/api/transactions",
    ]);
  });

  it("encodes the list query so accents and repeated tags survive the snapshot URL", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path.startsWith("/api/transactions")) {
        return jsonResponse(200, envelope(page));
      }
      if (path.startsWith("/api/categories")) {
        return jsonResponse(200, envelope(categories));
      }
      return jsonResponse(200, envelope(tags));
    });

    await loadHistorySnapshot(
      createApiClient({ fetch: fetchImpl }),
      new AbortController().signal,
      { q: "Café & té", tagId: ["tag-trips", "tag-home"] },
    );

    expect(fetchImpl.mock.calls.map((call) => call[0])).toContain(
      "/api/transactions?tagId=tag-trips&tagId=tag-home&q=Caf%C3%A9%20%26%20t%C3%A9",
    );
  });

  it("propagates a history page failure without labeling rows", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path.startsWith("/api/transactions")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      if (path.startsWith("/api/categories")) {
        return jsonResponse(200, envelope(categories));
      }
      return jsonResponse(200, envelope(tags));
    });

    const result = await loadHistorySnapshot(
      createApiClient({ fetch: fetchImpl }),
      new AbortController().signal,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.reason).toBe("network");
  });

  it("propagates a catalog failure instead of painting an unlabeled page", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path.startsWith("/api/categories")) {
        return jsonResponse(500, {
          error: {
            code: "internalError",
            message: "fallo",
            requestId: REQUEST_ID,
          },
        });
      }
      if (path.startsWith("/api/transactions")) {
        return jsonResponse(200, envelope(page));
      }
      return jsonResponse(200, envelope(tags));
    });

    const result = await loadHistorySnapshot(
      createApiClient({ fetch: fetchImpl }),
      new AbortController().signal,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.reason).toBe("api");
  });

  it("propagates a tag catalog failure", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path.startsWith("/api/tags")) {
        return jsonResponse(500, {
          error: {
            code: "internalError",
            message: "fallo",
            requestId: REQUEST_ID,
          },
        });
      }
      if (path.startsWith("/api/transactions")) {
        return jsonResponse(200, envelope(page));
      }
      return jsonResponse(200, envelope(categories));
    });

    const result = await loadHistorySnapshot(
      createApiClient({ fetch: fetchImpl }),
      new AbortController().signal,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.reason).toBe("api");
  });

  it("rejects a 204 from any of the three calls", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path.startsWith("/api/tags")) {
        return new Response(null, {
          status: 204,
          headers: { [REQUEST_ID_HEADER]: REQUEST_ID },
        });
      }
      if (path.startsWith("/api/transactions")) {
        return jsonResponse(200, envelope(page));
      }
      return jsonResponse(200, envelope(categories));
    });

    const result = await loadHistorySnapshot(
      createApiClient({ fetch: fetchImpl }),
      new AbortController().signal,
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 204,
    });
  });
});
