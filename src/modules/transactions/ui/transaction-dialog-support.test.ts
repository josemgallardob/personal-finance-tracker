import { describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGE } from "../../../shared/contracts/api";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import {
  apiFailureMessage,
  describeTransactionForDelete,
  loadTransactionEditor,
  transactionToFormValues,
} from "./transaction-dialog-support";
import {
  archivedMovement,
  categories,
  envelope,
  jsonResponse,
  movement,
  noContentResponse,
  notFoundResponse,
  preferences,
  REQUEST_ID,
  tags,
} from "./transaction-dialog-fixtures";

describe("transaction dialog support", () => {
  it("maps a movement into editable form values without the identifier", () => {
    const values = transactionToFormValues(movement, tags);

    expect(values).toEqual({
      type: "expense",
      amountText: "12,50",
      date: "2026-08-01",
      categoryId: "cat-food",
      concept: "Supermercado",
      note: "Semanal",
      tagSelections: [{ kind: "existing", tagId: "tag-trips", name: "Viajes" }],
    });
    expect(
      transactionToFormValues({ ...movement, concept: null, note: null }, tags),
    ).toEqual({
      type: "expense",
      amountText: "12,50",
      date: "2026-08-01",
      categoryId: "cat-food",
      concept: "",
      note: "",
      tagSelections: [{ kind: "existing", tagId: "tag-trips", name: "Viajes" }],
    });
  });

  it("falls back to the tag identifier when the catalog does not list it", () => {
    const values = transactionToFormValues(movement, []);

    expect(values.tagSelections).toEqual([
      { kind: "existing", tagId: "tag-trips", name: "tag-trips" },
    ]);
  });

  it("identifies a delete with concept, Spanish date and signed amount", () => {
    expect(describeTransactionForDelete(movement, categories)).toBe(
      "Se eliminará Supermercado · 01/08/2026 · −12,50\u00a0€. Esta acción no se puede deshacer.",
    );
    expect(describeTransactionForDelete(archivedMovement, categories)).toBe(
      "Se eliminará Antigua · 01/08/2026 · −12,50\u00a0€. Esta acción no se puede deshacer.",
    );
    expect(
      describeTransactionForDelete(
        { ...movement, type: "income", concept: "  " },
        categories,
      ),
    ).toBe(
      "Se eliminará Alimentación · 01/08/2026 · +12,50\u00a0€. Esta acción no se puede deshacer.",
    );
    expect(
      describeTransactionForDelete(
        { ...movement, categoryId: "missing", concept: null },
        [],
      ),
    ).toBe(
      "Se eliminará Movimiento · 01/08/2026 · −12,50\u00a0€. Esta acción no se puede deshacer.",
    );
  });

  it("prefers the API error message and falls back otherwise", () => {
    expect(
      apiFailureMessage(
        {
          ok: false,
          reason: "api",
          status: 422,
          error: {
            code: "validationFailed",
            message: API_ERROR_MESSAGE.validationFailed,
            requestId: REQUEST_ID,
          },
        },
        "fallback",
      ),
    ).toBe(API_ERROR_MESSAGE.validationFailed);
    expect(
      apiFailureMessage({ ok: false, reason: "network" }, "fallback"),
    ).toBe("fallback");
  });

  it("loads the movement together with preferences and all catalogs", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path.startsWith("/api/preferences")) {
        return jsonResponse(200, envelope(preferences));
      }
      if (path.startsWith("/api/categories")) {
        expect(path).toContain("status=all");
        return jsonResponse(200, envelope(categories));
      }
      if (path.startsWith("/api/tags")) {
        expect(path).toContain("status=all");
        return jsonResponse(200, envelope(tags));
      }
      if (path === "/api/transactions/tx-1") {
        return jsonResponse(200, envelope(movement));
      }
      return notFoundResponse();
    });
    const result = await loadTransactionEditor(
      createApiClient({ fetch: fetchImpl }),
      "tx-1",
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.noContent) {
      throw new Error("expected editor payload");
    }
    expect(result.data.today).toBe(preferences.today);
    expect(result.data.transaction.id).toBe("tx-1");
    expect(result.data.categories).toHaveLength(categories.length);
  });

  it("returns the movement 404 without requesting catalogs", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path === "/api/transactions/missing") {
        return notFoundResponse();
      }
      return jsonResponse(200, envelope(preferences));
    });
    const result = await loadTransactionEditor(
      createApiClient({ fetch: fetchImpl }),
      "missing",
      new AbortController().signal,
    );

    expect(result).toMatchObject({ ok: false, reason: "api", status: 404 });
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "/api/transactions/missing",
    ]);
  });

  it("propagates a catalog failure after the movement loaded", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path === "/api/transactions/tx-1") {
        return jsonResponse(200, envelope(movement));
      }
      if (path.startsWith("/api/preferences")) {
        return jsonResponse(200, envelope(preferences));
      }
      if (path.startsWith("/api/categories")) {
        return jsonResponse(200, envelope(categories));
      }
      if (path.startsWith("/api/tags")) {
        return jsonResponse(503, {
          error: {
            code: "serviceUnavailable",
            message: API_ERROR_MESSAGE.serviceUnavailable,
            requestId: REQUEST_ID,
          },
        });
      }
      return notFoundResponse();
    });
    const result = await loadTransactionEditor(
      createApiClient({ fetch: fetchImpl }),
      "tx-1",
      new AbortController().signal,
    );

    expect(result).toMatchObject({ ok: false, reason: "api", status: 503 });
  });

  it("propagates a preferences failure after the movement loaded", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path === "/api/transactions/tx-1") {
        return jsonResponse(200, envelope(movement));
      }
      if (path.startsWith("/api/preferences")) {
        return jsonResponse(503, {
          error: {
            code: "serviceUnavailable",
            message: API_ERROR_MESSAGE.serviceUnavailable,
            requestId: REQUEST_ID,
          },
        });
      }
      return notFoundResponse();
    });
    const result = await loadTransactionEditor(
      createApiClient({ fetch: fetchImpl }),
      "tx-1",
      new AbortController().signal,
    );

    expect(result).toMatchObject({ ok: false, reason: "api", status: 503 });
  });

  it("propagates a categories failure after preferences loaded", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path === "/api/transactions/tx-1") {
        return jsonResponse(200, envelope(movement));
      }
      if (path.startsWith("/api/preferences")) {
        return jsonResponse(200, envelope(preferences));
      }
      if (path.startsWith("/api/categories")) {
        return jsonResponse(503, {
          error: {
            code: "serviceUnavailable",
            message: API_ERROR_MESSAGE.serviceUnavailable,
            requestId: REQUEST_ID,
          },
        });
      }
      return notFoundResponse();
    });
    const result = await loadTransactionEditor(
      createApiClient({ fetch: fetchImpl }),
      "tx-1",
      new AbortController().signal,
    );

    expect(result).toMatchObject({ ok: false, reason: "api", status: 503 });
  });

  it("rejects a no-content movement as an invalid editor payload", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path === "/api/transactions/tx-1") {
        return noContentResponse();
      }
      if (path.startsWith("/api/preferences")) {
        return jsonResponse(200, envelope(preferences));
      }
      if (path.startsWith("/api/categories")) {
        return jsonResponse(200, envelope(categories));
      }
      if (path.startsWith("/api/tags")) {
        return jsonResponse(200, envelope(tags));
      }
      return notFoundResponse();
    });
    const result = await loadTransactionEditor(
      createApiClient({ fetch: fetchImpl }),
      "tx-1",
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "invalidResponse",
      status: 204,
    });
  });

  it.each(["preferences", "categories", "tags"] as const)(
    "rejects a no-content %s catalog as an invalid editor payload",
    async (resource) => {
      const fetchImpl = vi.fn<FetchLike>(async (path) => {
        if (path === "/api/transactions/tx-1") {
          return jsonResponse(200, envelope(movement));
        }
        if (path.startsWith("/api/preferences")) {
          return resource === "preferences"
            ? noContentResponse()
            : jsonResponse(200, envelope(preferences));
        }
        if (path.startsWith("/api/categories")) {
          return resource === "categories"
            ? noContentResponse()
            : jsonResponse(200, envelope(categories));
        }
        if (path.startsWith("/api/tags")) {
          return resource === "tags"
            ? noContentResponse()
            : jsonResponse(200, envelope(tags));
        }
        return notFoundResponse();
      });
      const result = await loadTransactionEditor(
        createApiClient({ fetch: fetchImpl }),
        "tx-1",
        new AbortController().signal,
      );

      expect(result).toMatchObject({
        ok: false,
        reason: "invalidResponse",
        status: 204,
      });
    },
  );
});
