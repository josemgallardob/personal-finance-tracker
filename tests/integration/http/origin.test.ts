/**
 * Origin policy for state-changing requests.
 *
 * The application has no CSRF token, so these tests pin the closed policy: a
 * mutation is accepted only from the configured private origin, and a missing
 * header is treated exactly like a foreign one.
 */

import { describe, expect, it } from "vitest";

import {
  checkRequestOrigin,
  isMutationMethod,
  MUTATION_METHODS,
} from "../../../src/shared/server/http/origin";
import { APP_ORIGIN, buildRequest } from "./helpers";

describe("isMutationMethod", () => {
  it.each(MUTATION_METHODS)("treats %s as a mutation", (method) => {
    expect(isMutationMethod(method)).toBe(true);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("treats %s as a read", (method) => {
    expect(isMutationMethod(method)).toBe(false);
  });

  it("compares the method case-insensitively", () => {
    expect(isMutationMethod("post")).toBe(true);
  });
});

describe("checkRequestOrigin", () => {
  it.each(MUTATION_METHODS)(
    "accepts a %s request from the configured origin",
    (method) => {
      const request = buildRequest({ method, origin: APP_ORIGIN });

      expect(checkRequestOrigin(request, APP_ORIGIN)).toBeNull();
    },
  );

  it("ignores a path and a trailing slash in the configured URL", () => {
    const request = buildRequest({ method: "POST", origin: APP_ORIGIN });

    expect(checkRequestOrigin(request, `${APP_ORIGIN}/`)).toBeNull();
  });

  it.each(MUTATION_METHODS)("refuses a %s request without Origin", (method) => {
    const request = buildRequest({ method, origin: null });

    expect(request.headers.get("origin")).toBeNull();
    expect(checkRequestOrigin(request, APP_ORIGIN)).toEqual({
      code: "forbidden",
      status: 403,
    });
  });

  it.each([
    ["a foreign host", "http://evil.example"],
    ["a different port", "http://localhost:3001"],
    ["a different scheme", "https://localhost:3000"],
    ["the opaque null origin", "null"],
    ["an unparseable value", "not a url"],
  ])("refuses a mutation from %s", (_reason, origin) => {
    const request = buildRequest({ method: "POST", origin });

    expect(checkRequestOrigin(request, APP_ORIGIN)).toEqual({
      code: "forbidden",
      status: 403,
    });
  });

  it.each(["GET", "HEAD", "OPTIONS"])(
    "lets a %s request through without an origin",
    (method) => {
      const request = buildRequest({ method, origin: null });

      expect(checkRequestOrigin(request, APP_ORIGIN)).toBeNull();
    },
  );

  it("lets a read from a foreign origin through, because it changes nothing", () => {
    const request = buildRequest({ origin: "http://evil.example" });

    expect(checkRequestOrigin(request, APP_ORIGIN)).toBeNull();
  });

  it("reports an unusable configured origin as a service failure", () => {
    const request = buildRequest({ method: "POST" });

    expect(checkRequestOrigin(request, "not a url")).toEqual({
      code: "serviceUnavailable",
      status: 503,
    });
  });
});
