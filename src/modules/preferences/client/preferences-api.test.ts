/**
 * Preferences browser adapter.
 *
 * Fetch is the only collaborator replaced. GET /api/preferences has no body
 * and no mutation method; a payload that is not the documented DTO is refused.
 */

import { describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGE } from "../../../shared/contracts/api";
import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { createPreferencesApi } from "./preferences-api";

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

function respondWith(response: Response): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(() => Promise.resolve(response.clone()));
}

function apiWith(fetchImpl: FetchLike) {
  return createPreferencesApi(createApiClient({ fetch: fetchImpl }));
}

const preferences = {
  locale: "es-ES",
  currency: "EUR",
  timeZone: "Europe/Madrid",
  today: "2026-09-08",
};

describe("preferencesApi", () => {
  it("reads preferences with GET and no body", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: preferences, requestId: REQUEST_ID }),
    );

    const result = await apiWith(fetchImpl).getPreferences();

    expect(result).toMatchObject({ ok: true, data: preferences });
    expect(fetchImpl).toHaveBeenCalledWith("/api/preferences", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: undefined,
      headers: { accept: "application/json" },
    });
  });

  it("keeps a 503 envelope from the server", async () => {
    const fetchImpl = respondWith(
      jsonResponse(503, {
        error: {
          code: "serviceUnavailable",
          message: API_ERROR_MESSAGE.serviceUnavailable,
          requestId: REQUEST_ID,
        },
      }),
    );

    const result = await apiWith(fetchImpl).getPreferences();

    expect(result).toEqual({
      ok: false,
      reason: "api",
      status: 503,
      error: {
        code: "serviceUnavailable",
        message: "El servicio no está disponible en este momento.",
        requestId: REQUEST_ID,
      },
    });
  });

  it("rejects a payload that names another locale or carries a workspace", async () => {
    const foreign = respondWith(
      jsonResponse(200, {
        data: { ...preferences, locale: "en-GB" },
        requestId: REQUEST_ID,
      }),
    );
    const leaked = respondWith(
      jsonResponse(200, {
        data: { ...preferences, workspaceId: "w-1" },
        requestId: REQUEST_ID,
      }),
    );

    expect(await apiWith(foreign).getPreferences()).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 200,
    });
    expect(await apiWith(leaked).getPreferences()).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 200,
    });
  });
});
