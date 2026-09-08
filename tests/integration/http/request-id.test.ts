/**
 * Correlation identifier policy.
 *
 * The header is client-controlled text that ends up in a log line and in a
 * response body, so these tests pin exactly which values survive and prove
 * that everything else is replaced rather than repaired.
 */

import { describe, expect, it } from "vitest";

import {
  isSafeRequestId,
  MAX_REQUEST_ID_LENGTH,
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "../../../src/shared/server/http/request-id";

function headersWith(value: string): Headers {
  return new Headers({ [REQUEST_ID_HEADER]: value });
}

describe("resolveRequestId", () => {
  it("keeps a client identifier made of unreserved characters", () => {
    const resolved = resolveRequestId(
      headersWith("abc_DEF-123"),
      () => "fresh",
    );

    expect(resolved).toBe("abc_DEF-123");
  });

  it("keeps an identifier of exactly the maximum length", () => {
    const proposed = "a".repeat(MAX_REQUEST_ID_LENGTH);

    expect(resolveRequestId(headersWith(proposed), () => "fresh")).toBe(
      proposed,
    );
  });

  it("replaces an identifier one character over the maximum length", () => {
    const proposed = "a".repeat(MAX_REQUEST_ID_LENGTH + 1);

    expect(resolveRequestId(headersWith(proposed), () => "fresh")).toBe(
      "fresh",
    );
  });

  it("generates an identifier when the header is absent", () => {
    expect(resolveRequestId(new Headers(), () => "fresh")).toBe("fresh");
  });

  it("replaces an empty header instead of returning an empty identifier", () => {
    expect(resolveRequestId(headersWith(""), () => "fresh")).toBe("fresh");
  });

  it.each([
    ["a quote that would break a JSON body", 'abc"def'],
    ["a space", "abc def"],
    ["a non-ASCII character", "abcñ"],
    ["a path separator", "abc/def"],
    ["a colon that would split a log field", "abc:def"],
  ])("replaces an identifier containing %s", (_reason, proposed) => {
    expect(isSafeRequestId(proposed)).toBe(false);
    expect(resolveRequestId(headersWith(proposed), () => "fresh")).toBe(
      "fresh",
    );
  });

  it.each([
    ["a newline that would forge a log line", 10],
    ["a carriage return", 13],
    ["a null byte", 0],
  ])("never accepts an identifier containing %s", (_reason, code) => {
    expect(isSafeRequestId(`abc${String.fromCharCode(code)}def`)).toBe(false);
  });

  it("generates a distinct identifier per request by default", () => {
    const first = resolveRequestId(new Headers());
    const second = resolveRequestId(new Headers());

    expect(first).not.toBe(second);
    expect(isSafeRequestId(first)).toBe(true);
  });
});
