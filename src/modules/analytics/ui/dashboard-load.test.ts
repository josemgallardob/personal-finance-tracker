/**
 * Dashboard snapshot loader.
 *
 * The suite pins that the summary and the catalogs travel together, that a
 * refusal of either call is reported unchanged so the view can explain it, and
 * that an answer without a representation is an invalid response rather than a
 * dashboard painted with missing names.
 */

import { describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGE } from "../../../shared/contracts/api";
import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import {
  categories,
  tags,
} from "../../transactions/ui/transaction-dialog-fixtures";
import { loadDashboardSnapshot } from "./dashboard-load";
import { dashboardFetch, summary } from "./dashboard-fixtures";

const REQUEST_ID = "req-dashboard";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  });
}

function load(fetchImpl: FetchLike) {
  return loadDashboardSnapshot(
    createApiClient({ fetch: fetchImpl }),
    new AbortController().signal,
    { period: "currentMonth" },
  );
}

describe("loadDashboardSnapshot", () => {
  it("reads the summary and the catalogs that name its movements", async () => {
    const fetchImpl = dashboardFetch();

    const result = await load(fetchImpl);

    expect(result).toMatchObject({
      ok: true,
      data: { summary, categories, tags },
    });
    expect(fetchImpl.mock.calls.map(([path]) => path.split("?")[0])).toEqual(
      expect.arrayContaining([
        "/api/analytics/summary",
        "/api/categories",
        "/api/tags",
      ]),
    );
  });

  it("keeps the refusal of a period the server rejected", async () => {
    const result = await load(
      dashboardFetch({
        summaryResponse: () =>
          jsonResponse(422, {
            error: {
              code: "validationFailed",
              message: API_ERROR_MESSAGE.validationFailed,
              requestId: REQUEST_ID,
            },
          }),
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "api", status: 422 });
  });

  it("keeps the failure of the catalogs the rows are named with", async () => {
    const result = await load(
      vi.fn<FetchLike>((path) =>
        path.startsWith("/api/analytics/summary")
          ? Promise.resolve(
              jsonResponse(200, { data: summary, requestId: REQUEST_ID }),
            )
          : Promise.reject(new TypeError("offline")),
      ),
    );

    expect(result).toEqual({ ok: false, reason: "network" });
  });

  it("keeps the failure of the preferences the selection is stored under", async () => {
    const result = await load(
      vi.fn<FetchLike>((path) =>
        path.startsWith("/api/preferences")
          ? Promise.resolve(
              jsonResponse(503, {
                error: {
                  code: "serviceUnavailable",
                  message: API_ERROR_MESSAGE.serviceUnavailable,
                  requestId: REQUEST_ID,
                },
              }),
            )
          : dashboardFetch()(path, { method: "GET" }),
      ),
    );

    expect(result).toMatchObject({ ok: false, reason: "api", status: 503 });
  });

  it("refuses a summary answered without any representation", async () => {
    const result = await load(
      dashboardFetch({
        summaryResponse: () =>
          new Response(null, {
            status: 204,
            headers: { [REQUEST_ID_HEADER]: REQUEST_ID },
          }),
      }),
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 204,
    });
  });
});
