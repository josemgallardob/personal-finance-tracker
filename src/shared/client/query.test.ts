/**
 * Stable query-string encoding.
 *
 * The tests pin the exact serialisation the history and classification
 * adapters rely on: omitted bounds, repeated tag identifiers, percent-encoded
 * ampersands and accents, and an opaque cursor that cannot be mistaken for
 * another parameter.
 */

import { describe, expect, it } from "vitest";

import { apiPath, encodeApiPathSegment, encodeApiQuery } from "./query";

describe("encodeApiQuery", () => {
  it("returns an empty string when every value is absent", () => {
    expect(
      encodeApiQuery({ dateFrom: undefined, dateTo: undefined, q: undefined }),
    ).toBe("");
  });

  it("omits an open date range bound instead of sending an empty parameter", () => {
    expect(encodeApiQuery({ dateFrom: "2026-09-01", dateTo: undefined })).toBe(
      "?dateFrom=2026-09-01",
    );
    expect(encodeApiQuery({ dateFrom: undefined, dateTo: "2026-09-08" })).toBe(
      "?dateTo=2026-09-08",
    );
  });

  it("repeats tagId in the supplied order instead of joining values", () => {
    expect(encodeApiQuery({ tagId: ["hogar", "ocio", "hogar"] })).toBe(
      "?tagId=hogar&tagId=ocio&tagId=hogar",
    );
  });

  it("encodes a single tagId as one parameter", () => {
    expect(encodeApiQuery({ tagId: "hogar" })).toBe("?tagId=hogar");
  });

  it("skips an empty tagId list so the filter is absent", () => {
    expect(encodeApiQuery({ tagId: [] })).toBe("");
  });

  it("encodes ampersands, spaces and accents without splitting the query", () => {
    expect(encodeApiQuery({ q: "Café & té" })).toBe(
      "?q=Caf%C3%A9%20%26%20t%C3%A9",
    );
    expect(encodeApiQuery({ q: "Nómina" })).toBe("?q=N%C3%B3mina");
  });

  it("encodes an opaque cursor so reserved characters stay inside the value", () => {
    expect(encodeApiQuery({ cursor: "a+b=c&d/e" })).toBe(
      "?cursor=a%2Bb%3Dc%26d%2Fe",
    );
  });

  it("writes untagged as the documented true/false strings", () => {
    expect(encodeApiQuery({ untagged: "true" })).toBe("?untagged=true");
    expect(encodeApiQuery({ untagged: "false" })).toBe("?untagged=false");
    expect(encodeApiQuery({ untagged: true })).toBe("?untagged=true");
    expect(encodeApiQuery({ untagged: false })).toBe("?untagged=false");
  });

  it("writes a numeric limit as a decimal integer string", () => {
    expect(encodeApiQuery({ limit: 20 })).toBe("?limit=20");
  });
});

describe("encodeApiPathSegment", () => {
  it("encodes reserved characters so they cannot split the path", () => {
    expect(encodeApiPathSegment("a/b&c")).toBe("a%2Fb%26c");
  });
});

describe("apiPath", () => {
  it("builds an origin-relative path under /api/ with a query suffix", () => {
    expect(apiPath("/api/transactions", { q: "Café" })).toBe(
      "/api/transactions?q=Caf%C3%A9",
    );
  });

  it("normalises a missing leading slash and accepts the bare API prefix", () => {
    expect(apiPath("api/tags")).toBe("/api/tags");
    expect(apiPath("/api")).toBe("/api");
  });

  it("rejects a path outside the API prefix before any request is built", () => {
    expect(() => apiPath("/apix/transactions")).toThrow(/same-origin/);
  });
});
