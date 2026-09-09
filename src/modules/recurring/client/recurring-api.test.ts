import { describe, expect, it, vi } from "vitest";

import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import type { RecurringRuleWriteBody } from "../contracts/http";
import { createRecurringApi } from "./recurring-api";

function respond(
  body: unknown,
  status = 200,
): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
          [REQUEST_ID_HEADER]: "request-id",
        },
      }),
    ),
  );
}

const ruleDto = {
  id: "rule-1",
  sourceTransactionId: "tx-1",
  type: "expense",
  amountMinor: 125_050,
  categoryId: "cat-rent",
  concept: "Alquiler",
  note: null,
  tagIds: ["tag-home"],
  monthlyDay: 5,
  nextDueDate: "2026-10-05",
  templateVersion: 2,
} as const;

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

  it("reads the overdue dates of a rule without sending a body", async () => {
    const fetch = respond({
      data: { rule: ruleDto, pendingDueDates: ["2026-08-05"] },
      requestId: "request-id",
    });
    const api = createRecurringApi(createApiClient({ fetch }));

    await expect(api.previewCatchUp("rule-1")).resolves.toMatchObject({
      ok: true,
      data: { rule: { id: "rule-1" }, pendingDueDates: ["2026-08-05"] },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/recurring-rules/rule-1/preview",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch.mock.calls[0]?.[1].body).toBeUndefined();
  });

  it("sends the template version on an edit and keeps the dates it recovered", async () => {
    const fetch = respond({
      data: { rule: ruleDto, generatedDueDates: ["2026-08-05", "2026-09-05"] },
      requestId: "request-id",
    });
    const api = createRecurringApi(createApiClient({ fetch }));
    const body: RecurringRuleWriteBody = {
      templateVersion: 1,
      type: "expense",
      amountMinor: 125_050,
      categoryId: "cat-rent",
      concept: "Alquiler",
      note: null,
      tagInputs: [{ tagId: "tag-home" }],
      monthlyDay: 5,
    };

    await expect(api.updateRule("rule-1", body)).resolves.toMatchObject({
      ok: true,
      data: {
        rule: { templateVersion: 2 },
        generatedDueDates: ["2026-08-05", "2026-09-05"],
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/recurring-rules/rule-1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(body) }),
    );
  });

  it("posts the template version to the deactivate endpoint", async () => {
    const fetch = respond({
      data: { rule: ruleDto, generatedDueDates: [] },
      requestId: "request-id",
    });
    const api = createRecurringApi(createApiClient({ fetch }));

    await expect(
      api.deactivateRule("rule-1", { templateVersion: 2 }),
    ).resolves.toMatchObject({ ok: true, data: { generatedDueDates: [] } });
    expect(fetch).toHaveBeenCalledWith(
      "/api/recurring-rules/rule-1/deactivate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ templateVersion: 2 }),
      }),
    );
  });

  it("refuses a change answered as a bare rule instead of the documented change", async () => {
    const fetch = respond({ data: ruleDto, requestId: "request-id" });
    const api = createRecurringApi(createApiClient({ fetch }));

    await expect(
      api.deactivateRule("rule-1", { templateVersion: 2 }),
    ).resolves.toEqual({ ok: false, reason: "invalidResponse", status: 200 });
  });

  it("keeps the refusal of a stale template version readable to the caller", async () => {
    const fetch = respond(
      {
        error: {
          code: "validationFailed",
          message: "La plantilla ha cambiado.",
          requestId: "request-id",
          details: [
            { field: "templateVersion", code: "invalidTemplateVersion" },
          ],
        },
      },
      422,
    );
    const api = createRecurringApi(createApiClient({ fetch }));

    await expect(
      api.deactivateRule("rule-1", { templateVersion: 1 }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "api",
      status: 422,
      error: {
        details: [{ field: "templateVersion", code: "invalidTemplateVersion" }],
      },
    });
  });

  it("escapes a rule identifier into the item path", async () => {
    const fetch = respond({
      data: { rule: ruleDto, generatedDueDates: [] },
      requestId: "request-id",
    });
    const api = createRecurringApi(createApiClient({ fetch }));

    await api.deactivateRule("rule/1", { templateVersion: 2 });
    expect(fetch).toHaveBeenCalledWith(
      "/api/recurring-rules/rule%2F1/deactivate",
      expect.anything(),
    );
  });
});
