/**
 * Transaction browser adapters.
 *
 * Fetch is the only collaborator replaced. The tests pin every collection and
 * item method, the query encoding of special characters, repeated tags, open
 * ranges, cursors and untagged, and the refusal of a payload that is not a
 * movement DTO.
 */

import { describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGE } from "../../../shared/contracts/api";
import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { createTransactionsApi } from "./transactions-api";

const REQUEST_ID = "req-01";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  });
}

function noContentResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { [REQUEST_ID_HEADER]: REQUEST_ID },
  });
}

function respondWith(response: Response): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(() => Promise.resolve(response.clone()));
}

function apiWith(fetchImpl: FetchLike) {
  return createTransactionsApi(createApiClient({ fetch: fetchImpl }));
}

const movement = {
  id: "tx-1",
  type: "expense" as const,
  amountMinor: 1250,
  date: "2026-09-06",
  categoryId: "cat-1",
  concept: "Pan",
  note: null,
  tagIds: ["tag-1"],
};

const page = { items: [movement], nextCursor: "opaque+cursor" };

const writeBody = {
  type: "expense" as const,
  amountMinor: 1250,
  date: "2026-09-06",
  categoryId: "cat-1",
  concept: "Café & té",
  note: null,
  tagInputs: [{ tagId: "tag-1" }, { name: "Año" }],
};

describe("transactionsApi collection", () => {
  it("lists an unfiltered page with GET", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, {
        data: { items: [], nextCursor: null },
        requestId: REQUEST_ID,
      }),
    );

    const result = await apiWith(fetchImpl).listTransactions();

    expect(result).toMatchObject({
      ok: true,
      data: { items: [], nextCursor: null },
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/transactions", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: undefined,
      headers: { accept: "application/json" },
    });
  });

  it("encodes ampersands and accents in the search without splitting filters", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: page, requestId: REQUEST_ID }),
    );

    await apiWith(fetchImpl).listTransactions({ q: "Café & Nómina" });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "/api/transactions?q=Caf%C3%A9%20%26%20N%C3%B3mina",
    );
  });

  it("repeats tagId for several identifiers, including a duplicate", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: page, requestId: REQUEST_ID }),
    );

    await apiWith(fetchImpl).listTransactions({
      tagId: ["hogar", "ocio", "hogar"],
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "/api/transactions?tagId=hogar&tagId=ocio&tagId=hogar",
    );
  });

  it("omits the missing bound of an open date range", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: page, requestId: REQUEST_ID }),
    );

    await apiWith(fetchImpl).listTransactions({ dateFrom: "2026-09-01" });
    await apiWith(fetchImpl).listTransactions({ dateTo: "2026-09-08" });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "/api/transactions?dateFrom=2026-09-01",
    );
    expect(fetchImpl.mock.calls[1][0]).toBe(
      "/api/transactions?dateTo=2026-09-08",
    );
  });

  it("encodes the opaque cursor and writes untagged as true or false", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: page, requestId: REQUEST_ID }),
    );

    await apiWith(fetchImpl).listTransactions({
      cursor: "a+b=c&d",
      untagged: true,
      limit: 20,
    });
    await apiWith(fetchImpl).listTransactions({ untagged: false });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "/api/transactions?untagged=true&cursor=a%2Bb%3Dc%26d&limit=20",
    );
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/transactions?untagged=false");
  });

  it("creates a movement with POST", async () => {
    const fetchImpl = respondWith(
      jsonResponse(201, { data: movement, requestId: REQUEST_ID }),
    );

    const result = await apiWith(fetchImpl).createTransaction(writeBody);

    expect(result).toMatchObject({ ok: true, status: 201, data: movement });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/transactions");
    expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
    expect(fetchImpl.mock.calls[0][1].body).toBe(JSON.stringify(writeBody));
  });
});

describe("transactionsApi item", () => {
  it("reads one movement with GET", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: movement, requestId: REQUEST_ID }),
    );

    const result = await apiWith(fetchImpl).getTransaction("tx-1");

    expect(result).toMatchObject({ ok: true, data: movement });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/transactions/tx-1");
    expect(fetchImpl.mock.calls[0][1].method).toBe("GET");
    expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
  });

  it("replaces a movement with PUT", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: movement, requestId: REQUEST_ID }),
    );

    await apiWith(fetchImpl).updateTransaction("tx-1", writeBody);

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/transactions/tx-1");
    expect(fetchImpl.mock.calls[0][1].method).toBe("PUT");
    expect(fetchImpl.mock.calls[0][1].body).toBe(JSON.stringify(writeBody));
  });

  it("deletes a movement with DELETE and reads 204", async () => {
    const fetchImpl = respondWith(noContentResponse());

    const result = await apiWith(fetchImpl).deleteTransaction("tx-1");

    expect(result).toEqual({
      ok: true,
      noContent: true,
      status: 204,
      requestId: REQUEST_ID,
    });
    expect(fetchImpl.mock.calls[0][1].method).toBe("DELETE");
    expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
  });

  it("encodes a reserved character in a movement identifier", async () => {
    const fetchImpl = respondWith(noContentResponse());

    await apiWith(fetchImpl).deleteTransaction("tx/1");

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/transactions/tx%2F1");
  });
});

describe("transactionsApi validation and errors", () => {
  it("keeps a 404 envelope from the server", async () => {
    const fetchImpl = respondWith(
      jsonResponse(404, {
        error: {
          code: "notFound",
          message: API_ERROR_MESSAGE.notFound,
          requestId: REQUEST_ID,
        },
      }),
    );

    const result = await apiWith(fetchImpl).getTransaction("missing");

    expect(result).toEqual({
      ok: false,
      reason: "api",
      status: 404,
      error: {
        code: "notFound",
        message: "El recurso solicitado no existe.",
        requestId: REQUEST_ID,
      },
    });
  });

  it("rejects a page that carries storage fields on an item", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, {
        data: {
          items: [{ ...movement, createdAt: 1 }],
          nextCursor: null,
        },
        requestId: REQUEST_ID,
      }),
    );

    const result = await apiWith(fetchImpl).listTransactions();

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 200,
    });
  });

  it("rejects a movement whose amount is not a number", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, {
        data: { ...movement, amountMinor: "1250" },
        requestId: REQUEST_ID,
      }),
    );

    const result = await apiWith(fetchImpl).getTransaction("tx-1");

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 200,
    });
  });
});
