/**
 * Envelope, headers and caching policy of every API response.
 *
 * Financial data must never be stored by a browser or a proxy, and an error
 * body must never grow beyond the sanitized representation, so both are pinned
 * here rather than left to each endpoint.
 */

import { describe, expect, it } from "vitest";

import {
  API_ERROR_MESSAGE,
  API_ERROR_STATUS,
  isApiErrorEnvelope,
  type ApiEnvelope,
} from "../../../src/shared/contracts/api";
import { apiFailure } from "../../../src/shared/server/http/failure";
import {
  API_CACHE_CONTROL,
  API_CONTENT_TYPE,
  dataResponse,
  errorResponse,
  noContentResponse,
  toApiErrorDto,
} from "../../../src/shared/server/http/responses";
import { readEnvelope } from "./helpers";

describe("dataResponse", () => {
  it("wraps the representation in the data envelope", async () => {
    const response = dataResponse(201, { id: "t-1" }, "req-1");

    expect(response.status).toBe(201);
    await expect(readEnvelope(response)).resolves.toEqual({
      data: { id: "t-1" },
      requestId: "req-1",
    });
  });

  it("forbids caching and echoes the correlation identifier", () => {
    const response = dataResponse(200, [], "req-2");

    expect(response.headers.get("cache-control")).toBe(API_CACHE_CONTROL);
    expect(API_CACHE_CONTROL).toBe("no-store");
    expect(response.headers.get("content-type")).toBe(API_CONTENT_TYPE);
    expect(response.headers.get("x-request-id")).toBe("req-2");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("noContentResponse", () => {
  it("answers 204 without a body but with the caching policy", async () => {
    const response = noContentResponse("req-3");

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("req-3");
    await expect(response.text()).resolves.toBe("");
  });
});

describe("errorResponse", () => {
  it.each(
    Object.entries(API_ERROR_STATUS).map(
      ([code, status]) => [code, status] as const,
    ),
  )("answers %s with status %i", async (code, status) => {
    const failure = apiFailure(
      code as keyof typeof API_ERROR_STATUS,
      undefined,
    );
    const response = errorResponse(failure, "req-4");

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const envelope = (await readEnvelope(response)) as ApiEnvelope<never>;

    expect(isApiErrorEnvelope(envelope)).toBe(true);
    expect(envelope).toEqual({
      error: {
        code,
        message: API_ERROR_MESSAGE[code as keyof typeof API_ERROR_MESSAGE],
        requestId: "req-4",
      },
    });
  });

  it("carries the rejected field paths and codes, never the values", async () => {
    const failure = apiFailure("validationFailed", [
      { field: "amountMinor", code: "invalidType" },
      { field: "tags.0.name", code: "tooBig" },
    ]);
    const response = errorResponse(failure, "req-5");
    const envelope = (await readEnvelope(response)) as {
      error: { details: unknown };
    };

    expect(response.status).toBe(422);
    expect(envelope.error.details).toEqual([
      { field: "amountMinor", code: "invalidType" },
      { field: "tags.0.name", code: "tooBig" },
    ]);
    expect(Object.keys(envelope.error as object).sort()).toEqual([
      "code",
      "details",
      "message",
      "requestId",
    ]);
  });

  it("omits an empty detail list instead of serialising it", () => {
    expect(toApiErrorDto(apiFailure("notFound", []), "req-6")).toEqual({
      code: "notFound",
      message: API_ERROR_MESSAGE.notFound,
      requestId: "req-6",
    });
  });

  it("uses Spanish user-visible copy that never quotes the payload", () => {
    for (const message of Object.values(API_ERROR_MESSAGE)) {
      expect(message.length).toBeGreaterThan(0);
      expect(message).toMatch(/[áéíóúñ¿¡.]/u);
    }
  });
});

describe("isApiErrorEnvelope", () => {
  it("recognises a data envelope", () => {
    const envelope: ApiEnvelope<number> = { data: 1, requestId: "req-7" };

    expect(isApiErrorEnvelope(envelope)).toBe(false);
  });
});
