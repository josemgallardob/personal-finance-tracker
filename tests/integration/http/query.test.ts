/**
 * Strict query-string parsing.
 *
 * A read carries its filters in the URL, so the same two rules that guard a
 * body must guard a query string: an unknown parameter is refused, and a
 * workspace identifier is never accepted from the client.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  parseSearchParams,
  searchParamsToRecord,
} from "../../../src/shared/server/http/query";
import { apiObject } from "../../../src/shared/server/http/schema";

const historySchema = apiObject({
  type: z.enum(["expense", "income"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  tagId: z.union([z.string(), z.array(z.string())]).optional(),
});

function params(query: string): URLSearchParams {
  return new URL(`http://localhost:3000/api/test${query}`).searchParams;
}

describe("searchParamsToRecord", () => {
  it("keeps a single occurrence as a string", () => {
    expect(searchParamsToRecord(params("?type=expense"))).toEqual({
      type: "expense",
    });
  });

  it("groups repeated occurrences into an array in order", () => {
    expect(searchParamsToRecord(params("?tagId=a&tagId=b"))).toEqual({
      tagId: ["a", "b"],
    });
  });

  it("returns an empty record for an empty query string", () => {
    expect(searchParamsToRecord(params(""))).toEqual({});
  });

  it("keeps an empty value instead of dropping the parameter", () => {
    expect(searchParamsToRecord(params("?type="))).toEqual({ type: "" });
  });
});

describe("parseSearchParams", () => {
  it("accepts a query string that matches the schema", () => {
    expect(parseSearchParams(historySchema, params("?type=income"))).toEqual({
      ok: true,
      value: { type: "income" },
    });
  });

  it("accepts several values of a repeatable parameter", () => {
    expect(
      parseSearchParams(historySchema, params("?tagId=a&tagId=b")),
    ).toEqual({ ok: true, value: { tagId: ["a", "b"] } });
  });

  it("refuses an unknown parameter with 422", () => {
    expect(parseSearchParams(historySchema, params("?unknown=1"))).toEqual({
      ok: false,
      failure: {
        code: "validationFailed",
        status: 422,
        details: [{ field: "unknown", code: "unknownField" }],
      },
    });
  });

  it("refuses a workspace identifier taken from the URL", () => {
    expect(
      parseSearchParams(historySchema, params("?workspaceId=w-1")),
    ).toEqual({
      ok: false,
      failure: {
        code: "validationFailed",
        status: 422,
        details: [{ field: "workspaceId", code: "unknownField" }],
      },
    });
  });

  it("refuses a value outside the accepted range without echoing it", () => {
    const result = parseSearchParams(historySchema, params("?limit=5000"));

    expect(result).toEqual({
      ok: false,
      failure: {
        code: "validationFailed",
        status: 422,
        details: [{ field: "limit", code: "tooBig" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("5000");
  });
});
