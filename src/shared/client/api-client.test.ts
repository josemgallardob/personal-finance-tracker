/**
 * Browser transport behaviour.
 *
 * The tests replace `fetch` and nothing else: envelope parsing, status
 * handling and the four failure situations run against real `Response`
 * objects, so a change in how a body is read or classified is observable here.
 * They pin the two properties a financial client cannot get wrong: a mutation
 * is sent exactly once, and "the server refused", "the browser never
 * arrived", "the answer is not the contract" and "we cancelled it" never
 * collapse into a single error.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGE } from "../contracts/api";
import { REQUEST_ID_HEADER } from "../contracts/http";
import { createApiClient, resolveApiPath, type FetchLike } from "./api-client";

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

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html", [REQUEST_ID_HEADER]: REQUEST_ID },
  });
}

function noContentResponse(withRequestId = true): Response {
  const headers = new Headers();

  if (withRequestId) {
    headers.set(REQUEST_ID_HEADER, REQUEST_ID);
  }

  return new Response(null, { status: 204, headers });
}

function unreadableResponse(status: number, error: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ [REQUEST_ID_HEADER]: REQUEST_ID }),
    text: () => Promise.reject(error),
  } as unknown as Response;
}

function respondWith(response: Response): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(() => Promise.resolve(response));
}

function rejectWith(error: unknown): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(() => Promise.reject(error));
}

function clientWith(fetchImpl: FetchLike) {
  return createApiClient({ fetch: fetchImpl });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveApiPath", () => {
  it("accepts an origin-relative path below the API prefix", () => {
    expect(resolveApiPath("/api/transactions?limit=20")).toBe(
      "/api/transactions?limit=20",
    );
  });

  it.each([
    ["an absolute URL to a foreign origin", "https://evil.example/api/x"],
    ["a protocol-relative URL", "//evil.example/api/x"],
    ["a path outside the API prefix", "/apix/transactions"],
    ["a relative path without a leading slash", "api/transactions"],
    ["the bare prefix without a resource", "/api"],
  ])("rejects %s", (_case, path) => {
    expect(() => resolveApiPath(path)).toThrow(/same-origin/);
  });
});

describe("createApiClient reads", () => {
  it("returns the typed representation and the correlation identifier", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: { total: 1250 }, requestId: REQUEST_ID }),
    );

    const result = await clientWith(fetchImpl).get<{ total: number }>(
      "/api/transactions",
    );

    expect(result).toEqual({
      ok: true,
      noContent: false,
      status: 200,
      requestId: REQUEST_ID,
      data: { total: 1250 },
    });
  });

  it("calls the relative path once with same-origin credentials and no cache", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: null, requestId: REQUEST_ID }),
    );

    await clientWith(fetchImpl).get("/api/preferences");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/api/preferences", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: undefined,
      headers: { accept: "application/json" },
    });
  });

  it("forwards the caller signal to the transport", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: [], requestId: REQUEST_ID }),
    );
    const controller = new AbortController();

    await clientWith(fetchImpl).get("/api/tags", {
      signal: controller.signal,
    });

    expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("rejects a foreign path before any request leaves the browser", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: null, requestId: REQUEST_ID }),
    );

    await expect(
      clientWith(fetchImpl).get("https://evil.example/api/transactions"),
    ).rejects.toThrow(/same-origin/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the browser fetch when no transport is injected", async () => {
    const globalFetch = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { data: 7, requestId: REQUEST_ID })),
    );
    vi.stubGlobal("fetch", globalFetch);

    const result = await createApiClient().get<number>("/api/preferences");

    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, data: 7 });
  });
});

describe("createApiClient mutations", () => {
  it("sends a JSON payload and returns the created representation", async () => {
    const fetchImpl = respondWith(
      jsonResponse(201, { data: { id: "t1" }, requestId: REQUEST_ID }),
    );

    const result = await clientWith(fetchImpl).post<{ id: string }>(
      "/api/transactions",
      { amountMinor: 1250, concept: "Café" },
    );

    expect(result).toMatchObject({ status: 201, data: { id: "t1" } });
    expect(fetchImpl).toHaveBeenCalledWith("/api/transactions", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: undefined,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: '{"amountMinor":1250,"concept":"Café"}',
    });
  });

  it("renames a category with PATCH", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: { id: "c1" }, requestId: REQUEST_ID }),
    );

    const result = await clientWith(fetchImpl).patch("/api/categories/c1", {
      name: "Casa",
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledWith("/api/categories/c1", {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
      signal: undefined,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: '{"name":"Casa"}',
    });
  });

  it("replaces a movement with PUT", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: { id: "t1" }, requestId: REQUEST_ID }),
    );

    const result = await clientWith(fetchImpl).put("/api/transactions/t1", {
      amountMinor: 900,
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(fetchImpl.mock.calls[0][1].method).toBe("PUT");
    expect(fetchImpl.mock.calls[0][1].body).toBe('{"amountMinor":900}');
  });

  it("reads a 204 as an accepted result without parsing a body", async () => {
    const fetchImpl = respondWith(noContentResponse());

    const result = await clientWith(fetchImpl).delete("/api/transactions/t1");

    expect(result).toEqual({
      ok: true,
      noContent: true,
      status: 204,
      requestId: REQUEST_ID,
    });
    expect(fetchImpl.mock.calls[0][1].method).toBe("DELETE");
    expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
  });

  it("refuses a 204 that cannot be correlated with a server log line", async () => {
    const fetchImpl = respondWith(noContentResponse(false));

    const result = await clientWith(fetchImpl).delete("/api/transactions/t1");

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 204,
    });
  });
});

describe("createApiClient refusals", () => {
  it("keeps every rejected field of a 422 so a form can mark them", async () => {
    const fetchImpl = respondWith(
      jsonResponse(422, {
        error: {
          code: "validationFailed",
          message: API_ERROR_MESSAGE.validationFailed,
          requestId: REQUEST_ID,
          details: [
            { field: "amountMinor", code: "invalidAmount" },
            { field: "categoryId", code: "incompatibleCategoryType" },
          ],
        },
      }),
    );

    const result = await clientWith(fetchImpl).post("/api/transactions", {});

    expect(result).toEqual({
      ok: false,
      reason: "api",
      status: 422,
      error: {
        code: "validationFailed",
        message: "Los datos enviados no son válidos.",
        requestId: REQUEST_ID,
        details: [
          { field: "amountMinor", code: "invalidAmount" },
          { field: "categoryId", code: "incompatibleCategoryType" },
        ],
      },
    });
  });

  it("keeps the sanitized 500 envelope without inventing detail", async () => {
    const fetchImpl = respondWith(
      jsonResponse(500, {
        error: {
          code: "internalError",
          message: API_ERROR_MESSAGE.internalError,
          requestId: REQUEST_ID,
        },
      }),
    );

    const result = await clientWith(fetchImpl).get("/api/transactions");

    expect(result).toEqual({
      ok: false,
      reason: "api",
      status: 500,
      error: {
        code: "internalError",
        message: "Se ha producido un error inesperado.",
        requestId: REQUEST_ID,
      },
    });
  });

  it.each([
    ["an unknown error code", { code: "teapot", message: "x", requestId: "r" }],
    ["a missing message", { code: "notFound", requestId: "r" }],
    ["a missing correlation identifier", { code: "notFound", message: "x" }],
    [
      "details that are not a list",
      { code: "notFound", message: "x", requestId: "r", details: "amount" },
    ],
    [
      "a detail without a field path",
      {
        code: "notFound",
        message: "x",
        requestId: "r",
        details: [{ code: "required" }],
      },
    ],
    [
      "a detail without a code",
      {
        code: "notFound",
        message: "x",
        requestId: "r",
        details: [{ field: "amountMinor" }],
      },
    ],
  ])("reports %s as an invalid response", async (_case, error) => {
    const fetchImpl = respondWith(jsonResponse(404, { error }));

    const result = await clientWith(fetchImpl).get("/api/transactions/t1");

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 404,
    });
  });

  it.each([
    ["a data envelope", { data: null, requestId: REQUEST_ID }],
    ["an error member that is not an object", { error: "notFound" }],
    ["a payload that is not an object", [{ code: "notFound" }]],
  ])(
    "reports an error status answered with %s as an invalid response",
    async (_case, body) => {
      const fetchImpl = respondWith(jsonResponse(500, body));

      const result = await clientWith(fetchImpl).get("/api/transactions");

      expect(result).toEqual({
        ok: false,
        reason: "invalidResponse",
        status: 500,
      });
    },
  );

  it("reports an error status without an envelope as an invalid response", async () => {
    const fetchImpl = respondWith(textResponse(502, "<html>gateway</html>"));

    const result = await clientWith(fetchImpl).get("/api/transactions");

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 502,
    });
  });
});

describe("createApiClient malformed successes", () => {
  it("reports a body that is not JSON as an invalid response", async () => {
    const fetchImpl = respondWith(textResponse(200, "<html>proxy</html>"));

    const result = await clientWith(fetchImpl).get("/api/transactions");

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 200,
    });
  });

  it.each([
    ["no data member", { requestId: REQUEST_ID }],
    ["no correlation identifier", { data: [] }],
    [
      "an error envelope answered with a success status",
      {
        error: {
          code: "notFound",
          message: "x",
          requestId: REQUEST_ID,
        },
      },
    ],
    ["a payload that is not an object", 42],
  ])("reports a 200 with %s as an invalid response", async (_case, body) => {
    const fetchImpl = respondWith(jsonResponse(200, body));

    const result = await clientWith(fetchImpl).get("/api/transactions");

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 200,
    });
  });
});

describe("createApiClient transport failures", () => {
  it("reports a request that never reached the server as a network failure", async () => {
    const fetchImpl = rejectWith(new TypeError("Failed to fetch"));
    const controller = new AbortController();

    const result = await clientWith(fetchImpl).get("/api/transactions", {
      signal: controller.signal,
    });

    expect(result).toEqual({ ok: false, reason: "network" });
  });

  it("reports a cancelled request through its signal, not as a network failure", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<FetchLike>(() => {
      controller.abort();

      return Promise.reject(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    });

    const result = await clientWith(fetchImpl).get("/api/transactions", {
      signal: controller.signal,
    });

    expect(result).toEqual({ ok: false, reason: "aborted" });
  });

  it("reports an abort raised without the caller signal as a cancellation", async () => {
    const fetchImpl = rejectWith({ name: "AbortError" });

    const result = await clientWith(fetchImpl).get("/api/transactions");

    expect(result).toEqual({ ok: false, reason: "aborted" });
  });

  it("reports a body that breaks mid-read as a network failure", async () => {
    const fetchImpl = respondWith(
      unreadableResponse(200, new TypeError("network error")),
    );

    const result = await clientWith(fetchImpl).get("/api/transactions");

    expect(result).toEqual({ ok: false, reason: "network" });
  });

  it("reports a body abandoned by an abort as a cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = respondWith(
      unreadableResponse(200, new DOMException("aborted", "AbortError")),
    );

    const result = await clientWith(fetchImpl).get("/api/transactions", {
      signal: controller.signal,
    });

    expect(result).toEqual({ ok: false, reason: "aborted" });
  });
});

describe("createApiClient retry policy", () => {
  it.each([
    ["POST", "/api/transactions"],
    ["PUT", "/api/transactions/t1"],
    ["PATCH", "/api/categories/c1"],
    ["DELETE", "/api/transactions/t1"],
  ] as const)(
    "sends a %s exactly once when the server answers 500",
    async (method, path) => {
      const fetchImpl = respondWith(
        jsonResponse(500, {
          error: {
            code: "internalError",
            message: API_ERROR_MESSAGE.internalError,
            requestId: REQUEST_ID,
          },
        }),
      );

      const result = await clientWith(fetchImpl).request({
        method,
        path,
        body: method === "DELETE" ? undefined : { amountMinor: 1250 },
      });

      expect(result).toMatchObject({ ok: false, reason: "api", status: 500 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["POST", "/api/transactions"],
    ["PUT", "/api/transactions/t1"],
    ["PATCH", "/api/categories/c1"],
    ["DELETE", "/api/transactions/t1"],
  ] as const)(
    "sends a %s exactly once when the transport fails",
    async (method, path) => {
      const fetchImpl = rejectWith(new TypeError("Failed to fetch"));

      const result = await clientWith(fetchImpl).request({ method, path });

      expect(result).toEqual({ ok: false, reason: "network" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
});
