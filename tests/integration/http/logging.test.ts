/**
 * Log sanitisation.
 *
 * Concepts, notes, amounts, tags and search text are personal financial data.
 * These tests prove that the query string never becomes a route and that an
 * unexpected failure is recorded by its class, not by a message that can quote
 * the row that failed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  consoleApiLogger,
  describeFailureType,
  logRoute,
} from "../../../src/shared/server/http/logging";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logRoute", () => {
  it("keeps the path of a request", () => {
    expect(logRoute(new URL("http://localhost:3000/api/transactions"))).toBe(
      "/api/transactions",
    );
  });

  it("drops the query string, which carries the search text", () => {
    const url = new URL(
      "http://localhost:3000/api/transactions?q=alquiler%20marzo&tagId=a",
    );

    expect(logRoute(url)).toBe("/api/transactions");
    expect(logRoute(url)).not.toContain("alquiler");
  });

  it("drops a fragment as well", () => {
    expect(logRoute(new URL("http://localhost:3000/api/x#secret"))).toBe(
      "/api/x",
    );
  });
});

describe("describeFailureType", () => {
  it("names the class of an error without its message", () => {
    const cause = new TypeError("column note = 'Alquiler de marzo'");

    expect(describeFailureType(cause)).toBe("TypeError");
    expect(describeFailureType(cause)).not.toContain("Alquiler");
  });

  it("names the class of a custom error subclass", () => {
    class StorageFailure extends Error {}

    expect(describeFailureType(new StorageFailure("1250"))).toBe(
      "StorageFailure",
    );
  });

  it.each([
    ["a string", "boom", "string"],
    ["a number", 500, "number"],
    ["undefined", undefined, "undefined"],
    ["an object", { note: "Alquiler" }, "object"],
  ])("reports the type of %s that was thrown", (_reason, cause, expected) => {
    expect(describeFailureType(cause)).toBe(expected);
  });
});

describe("consoleApiLogger", () => {
  it("writes one JSON line built only from the accepted fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    consoleApiLogger({
      requestId: "req-1",
      method: "POST",
      route: "/api/transactions",
      status: 422,
      durationMs: 7,
      errorCode: "validationFailed",
      fieldErrorCount: 2,
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(info.mock.calls[0][0] as string)).toEqual({
      event: "api_request",
      requestId: "req-1",
      method: "POST",
      route: "/api/transactions",
      status: 422,
      durationMs: 7,
      errorCode: "validationFailed",
      fieldErrorCount: 2,
    });
  });
});
