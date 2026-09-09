import { describe, expect, it, vi } from "vitest";

import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { createRecurringApi } from "./recurring-api";

function respond(body: unknown): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          [REQUEST_ID_HEADER]: "request-id",
        },
      }),
    ),
  );
}

describe("recurringApi", () => {
  it("posts only the selected day to the server preview endpoint", async () => {
    const fetch = respond({
      data: { nextDueDate: "2026-09-30" },
      requestId: "request-id",
    });
    const api = createRecurringApi(createApiClient({ fetch }));
    const controller = new AbortController();

    await expect(
      api.previewNextDueDate({ monthlyDay: 31 }, { signal: controller.signal }),
    ).resolves.toMatchObject({ ok: true, data: { nextDueDate: "2026-09-30" } });
    expect(fetch).toHaveBeenCalledWith(
      "/api/recurring-rules/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ monthlyDay: 31 }),
        signal: controller.signal,
      }),
    );
  });
});
