import { describe, expect, it } from "vitest";

import type { ApiClientFailure } from "../../../shared/client/api-client";
import type {
  ApiErrorCode,
  ApiFieldErrorDto,
} from "../../../shared/contracts/api";
import { recurringConflictCopy } from "./recurring-copy";
import { recurringFailureMessage } from "./recurring-failure";

const FALLBACK = "No se ha podido guardar.";

function apiFailure(
  code: ApiErrorCode,
  details?: readonly ApiFieldErrorDto[],
): ApiClientFailure {
  return {
    ok: false,
    reason: "api",
    status: 422,
    error: {
      code,
      message: "Mensaje del servidor",
      requestId: "request-id",
      ...(details ? { details } : {}),
    },
  };
}

describe("recurringFailureMessage", () => {
  it("keeps the caller fallback for transport failures the server never explained", () => {
    expect(
      recurringFailureMessage({ ok: false, reason: "network" }, FALLBACK),
    ).toBe(FALLBACK);
    expect(
      recurringFailureMessage(
        { ok: false, reason: "invalidResponse", status: 200 },
        FALLBACK,
      ),
    ).toBe(FALLBACK);
    expect(
      recurringFailureMessage({ ok: false, reason: "aborted" }, FALLBACK),
    ).toBe(FALLBACK);
  });

  it("guides the owner out of an archived or incompatible classification", () => {
    expect(
      recurringFailureMessage(
        apiFailure("conflict", [{ field: "categoryId", code: "archived" }]),
        FALLBACK,
      ),
    ).toBe(recurringConflictCopy.categoryArchived);
    expect(
      recurringFailureMessage(
        apiFailure("validationFailed", [
          { field: "type", code: "incompatibleCategoryType" },
        ]),
        FALLBACK,
      ),
    ).toBe(recurringConflictCopy.categoryIncompatible);
    expect(
      recurringFailureMessage(
        apiFailure("notFound", [{ field: "categoryId", code: "notFound" }]),
        FALLBACK,
      ),
    ).toBe(recurringConflictCopy.categoryNotFound);
    expect(
      recurringFailureMessage(
        apiFailure("conflict", [{ field: "tagId", code: "archived" }]),
        FALLBACK,
      ),
    ).toBe(recurringConflictCopy.tagUnavailable);
  });

  it("separates a stale template from a rule that is already deactivated", () => {
    expect(
      recurringFailureMessage(
        apiFailure("validationFailed", [
          { field: "templateVersion", code: "invalidTemplateVersion" },
        ]),
        FALLBACK,
      ),
    ).toBe(recurringConflictCopy.staleTemplate);
    expect(
      recurringFailureMessage(
        apiFailure("conflict", [
          { field: "deactivatedAt", code: "alreadyDeactivated" },
        ]),
        FALLBACK,
      ),
    ).toBe(recurringConflictCopy.alreadyDeactivated);
  });

  it("answers a storage refusal without repeating its server message", () => {
    expect(
      recurringFailureMessage(apiFailure("serviceUnavailable"), FALLBACK),
    ).toBe(recurringConflictCopy.unavailable);
  });

  it("shows the server message when no field error names an action", () => {
    expect(
      recurringFailureMessage(
        apiFailure("validationFailed", [
          { field: "amountMinor", code: "invalidAmount" },
        ]),
        FALLBACK,
      ),
    ).toBe("Mensaje del servidor");
    expect(
      recurringFailureMessage(apiFailure("validationFailed"), FALLBACK),
    ).toBe("Mensaje del servidor");
  });
});
