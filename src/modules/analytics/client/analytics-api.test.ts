/**
 * Analytics browser adapters.
 *
 * Fetch is the only collaborator replaced, so the URL encoding, the envelope
 * reading and the contract validation all run for real. The suite pins that a
 * preset never sends months, that a custom range sends both, that the endpoints
 * without a window send no parameter at all, and that a payload which is not
 * the documented DTO is reported as an invalid response instead of reaching a
 * card.
 */

import { describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGE } from "../../../shared/contracts/api";
import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { createAnalyticsApi } from "./analytics-api";
import { summary } from "../ui/dashboard-fixtures";

const REQUEST_ID = "req-analytics";

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
  return createAnalyticsApi(createApiClient({ fetch: fetchImpl }));
}

function envelope<TData>(data: TData) {
  return { data, requestId: REQUEST_ID };
}

const getInit = {
  method: "GET",
  credentials: "same-origin",
  cache: "no-store",
  signal: undefined,
  headers: { accept: "application/json" },
};

describe("analyticsApi summary", () => {
  it("requests a preset period without any month", async () => {
    const fetchImpl = respondWith(jsonResponse(200, envelope(summary)));

    const result = await apiWith(fetchImpl).readSummary({
      period: "lastThreeMonths",
    });

    expect(result).toMatchObject({ ok: true, data: summary });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/analytics/summary?period=lastThreeMonths",
      getInit,
    );
  });

  it("requests a custom range with both natural months", async () => {
    const fetchImpl = respondWith(jsonResponse(200, envelope(summary)));

    await apiWith(fetchImpl).readSummary({
      period: "customMonthRange",
      from: "2026-01",
      to: "2026-03",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/analytics/summary?period=customMonthRange&from=2026-01&to=2026-03",
      getInit,
    );
  });

  it("forwards the abort signal of the view that started the request", async () => {
    const fetchImpl = respondWith(jsonResponse(200, envelope(summary)));
    const controller = new AbortController();

    await apiWith(fetchImpl).readSummary(
      { period: "currentMonth" },
      { signal: controller.signal },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/analytics/summary?period=currentMonth",
      { ...getInit, signal: controller.signal },
    );
  });

  it("reports a payload that is not the documented summary as invalid", async () => {
    const fetchImpl = respondWith(
      jsonResponse(
        200,
        envelope({
          ...summary,
          totals: { ...summary.totals, current: { incomeMinor: 1 } },
        }),
      ),
    );

    const result = await apiWith(fetchImpl).readSummary({
      period: "currentMonth",
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 200,
    });
  });

  it("keeps the refusal of a period the server rejected", async () => {
    const fetchImpl = respondWith(
      jsonResponse(422, {
        error: {
          code: "validationFailed",
          message: API_ERROR_MESSAGE.validationFailed,
          requestId: REQUEST_ID,
          details: [{ field: "to", code: "incompatibleFilters" }],
        },
      }),
    );

    const result = await apiWith(fetchImpl).readSummary({
      period: "customMonthRange",
      from: "2026-05",
      to: "2026-01",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "api",
      status: 422,
      error: { details: [{ field: "to", code: "incompatibleFilters" }] },
    });
  });
});

describe("analyticsApi windows", () => {
  it("reads the evolution series without any parameter", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, envelope({ kind: "empty" })),
    );

    const result = await apiWith(fetchImpl).readEvolution();

    expect(result).toMatchObject({ ok: true, data: { kind: "empty" } });
    expect(fetchImpl).toHaveBeenCalledWith("/api/analytics/evolution", getInit);
  });

  it("reads the averages without any parameter", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, envelope({ kind: "insufficientHistory" })),
    );

    const result = await apiWith(fetchImpl).readAverages();

    expect(result).toMatchObject({
      ok: true,
      data: { kind: "insufficientHistory" },
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/analytics/averages", getInit);
  });

  it("reports averages that are not the documented union as invalid", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, envelope({ kind: "months" })),
    );

    const result = await apiWith(fetchImpl).readAverages();

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 200,
    });
  });
});
