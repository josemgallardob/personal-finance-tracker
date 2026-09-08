import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRANSACTION_PAGE_SIZE,
  encodeListCursor,
  escapeLikeLiteral,
  MAX_TRANSACTION_PAGE_SIZE,
  parseListTransactionsInput,
} from "./list-transaction-filters";

const KEYSET = {
  date: "2026-03-14",
  createdAt: 1_746_268_800_000,
  id: "tx-last",
};

function fingerprintOf(
  input: Parameters<typeof parseListTransactionsInput>[0],
): string {
  const parsed = parseListTransactionsInput(input);

  if (!parsed.ok) {
    throw new Error(`Expected valid filters: ${JSON.stringify(parsed)}`);
  }

  return parsed.value.fingerprint;
}

describe("parseListTransactionsInput", () => {
  it("defaults the page size and leaves optional filters open", () => {
    const parsed = parseListTransactionsInput({ workspaceId: "workspace-1" });

    expect(parsed).toEqual({
      ok: true,
      value: {
        workspaceId: "workspace-1",
        dateFrom: null,
        dateTo: null,
        type: null,
        categoryId: null,
        tagIds: [],
        untagged: false,
        textQuery: null,
        after: null,
        limit: DEFAULT_TRANSACTION_PAGE_SIZE,
        fingerprint: fingerprintOf({ workspaceId: "workspace-1" }),
      },
    });
  });

  it("accepts inclusive open date limits and the maximum page size", () => {
    const parsed = parseListTransactionsInput({
      workspaceId: "workspace-1",
      dateFrom: "2026-03-01",
      dateTo: "2026-03-01",
      type: "expense",
      categoryId: "category-1",
      tagIds: ["tag-b", "tag-a", "tag-a"],
      q: "  café  ",
      limit: MAX_TRANSACTION_PAGE_SIZE,
    });

    expect(parsed.ok ? parsed.value.dateFrom : null).toBe("2026-03-01");
    expect(parsed.ok ? parsed.value.dateTo : null).toBe("2026-03-01");
    expect(parsed.ok ? parsed.value.tagIds : []).toEqual(["tag-a", "tag-b"]);
    expect(parsed.ok ? parsed.value.textQuery : null).toBe("café");
    expect(parsed.ok ? parsed.value.limit : 0).toBe(MAX_TRANSACTION_PAGE_SIZE);
  });

  it("binds a cursor only when its fingerprint matches the filters", () => {
    const fingerprint = fingerprintOf({
      workspaceId: "workspace-1",
      type: "income",
    });
    const cursor = encodeListCursor(KEYSET, fingerprint);
    const parsed = parseListTransactionsInput({
      workspaceId: "workspace-1",
      type: "income",
      cursor,
    });

    expect(parsed.ok ? parsed.value.after : null).toEqual(KEYSET);
  });

  it("treats the same tags in another order as the same filter sequence", () => {
    const fingerprint = fingerprintOf({
      workspaceId: "workspace-1",
      tagIds: ["tag-b", "tag-a"],
    });
    const cursor = encodeListCursor(KEYSET, fingerprint);
    const parsed = parseListTransactionsInput({
      workspaceId: "workspace-1",
      tagIds: ["tag-a", "tag-b"],
      cursor,
    });

    expect(parsed.ok ? parsed.value.after : null).toEqual(KEYSET);
  });

  it("refuses a cursor issued for another filter set", () => {
    const cursor = encodeListCursor(
      KEYSET,
      fingerprintOf({ workspaceId: "workspace-1", q: "rent" }),
    );
    const parsed = parseListTransactionsInput({
      workspaceId: "workspace-1",
      q: "food",
      cursor,
    });

    expect(parsed).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
  });

  it("refuses a corrupt cursor instead of continuing the sequence", () => {
    const parsed = parseListTransactionsInput({
      workspaceId: "workspace-1",
      cursor: "@@@not-a-cursor",
    });

    expect(parsed).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
  });

  it("refuses a cursor payload that is not the current encoding", () => {
    const json = Buffer.from(JSON.stringify({ v: 2 }), "utf8").toString(
      "base64url",
    );
    const asText = Buffer.from('"cursor"', "utf8").toString("base64url");
    const truncated = Buffer.from("{", "utf8").toString("base64url");
    const emptyFingerprint = Buffer.from(
      JSON.stringify({
        v: 1,
        d: KEYSET.date,
        c: KEYSET.createdAt,
        i: KEYSET.id,
        f: "",
      }),
      "utf8",
    ).toString("base64url");

    expect(
      parseListTransactionsInput({
        workspaceId: "workspace-1",
        cursor: json,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
    expect(
      parseListTransactionsInput({
        workspaceId: "workspace-1",
        cursor: asText,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
    expect(
      parseListTransactionsInput({
        workspaceId: "workspace-1",
        cursor: truncated,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
    expect(
      parseListTransactionsInput({
        workspaceId: "workspace-1",
        cursor: emptyFingerprint,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
  });

  it("refuses a cursor whose keyset is not a stored movement identity", () => {
    const fingerprint = fingerprintOf({ workspaceId: "workspace-1" });
    const brokenDate = Buffer.from(
      JSON.stringify({
        v: 1,
        d: "14-03-2026",
        c: KEYSET.createdAt,
        i: KEYSET.id,
        f: fingerprint,
      }),
      "utf8",
    ).toString("base64url");
    const brokenNegative = Buffer.from(
      JSON.stringify({
        v: 1,
        d: KEYSET.date,
        c: -1,
        i: KEYSET.id,
        f: fingerprint,
      }),
      "utf8",
    ).toString("base64url");
    const brokenTime = Buffer.from(
      JSON.stringify({
        v: 1,
        d: KEYSET.date,
        c: "now",
        i: KEYSET.id,
        f: fingerprint,
      }),
      "utf8",
    ).toString("base64url");
    const brokenId = Buffer.from(
      JSON.stringify({
        v: 1,
        d: KEYSET.date,
        c: KEYSET.createdAt,
        i: "not a uuid",
        f: fingerprint,
      }),
      "utf8",
    ).toString("base64url");

    expect(
      parseListTransactionsInput({
        workspaceId: "workspace-1",
        cursor: brokenDate,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
    expect(
      parseListTransactionsInput({
        workspaceId: "workspace-1",
        cursor: brokenTime,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
    expect(
      parseListTransactionsInput({
        workspaceId: "workspace-1",
        cursor: brokenNegative,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
    expect(
      parseListTransactionsInput({
        workspaceId: "workspace-1",
        cursor: brokenId,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
  });

  it("refuses an inverted date range without applying either limit", () => {
    const parsed = parseListTransactionsInput({
      workspaceId: "workspace-1",
      dateFrom: "2026-03-02",
      dateTo: "2026-03-01",
    });

    expect(parsed).toEqual({
      ok: false,
      errors: [{ field: "dateFrom", code: "invalidDate" }],
    });
  });

  it("refuses malformed dates, types, identifiers and limits", () => {
    const parsed = parseListTransactionsInput({
      workspaceId: "workspace-1",
      dateFrom: "2026-13-01",
      dateTo: "not-a-date",
      type: "transfer",
      categoryId: "bad id",
      tagIds: ["also bad"],
      limit: 0,
    });

    expect(parsed).toEqual({
      ok: false,
      errors: [
        { field: "dateFrom", code: "invalidDate" },
        { field: "dateTo", code: "invalidDate" },
        { field: "type", code: "invalidTransactionType" },
        { field: "categoryId", code: "invalidIdentifier" },
        { field: "tagId", code: "invalidIdentifier" },
        { field: "limit", code: "invalidLimit" },
      ],
    });
  });

  it("refuses combining untagged with any tag identifier", () => {
    const parsed = parseListTransactionsInput({
      workspaceId: "workspace-1",
      tagIds: ["tag-1"],
      untagged: true,
    });

    expect(parsed).toEqual({
      ok: false,
      errors: [
        { field: "tagId", code: "incompatibleFilters" },
        { field: "untagged", code: "incompatibleFilters" },
      ],
    });
  });

  it("accepts untagged without a tag filter", () => {
    const parsed = parseListTransactionsInput({
      workspaceId: "workspace-1",
      untagged: true,
      type: "expense",
    });

    expect(parsed.ok ? parsed.value.untagged : false).toBe(true);
    expect(parsed.ok ? parsed.value.tagIds : ["x"]).toEqual([]);
  });

  it("ignores blank search text and an omitted cursor", () => {
    const parsed = parseListTransactionsInput({
      workspaceId: "workspace-1",
      q: "   ",
      cursor: "",
      untagged: false,
    });

    expect(parsed.ok ? parsed.value.textQuery : "x").toBeNull();
    expect(parsed.ok ? parsed.value.after : KEYSET).toBeNull();
    expect(parsed.ok ? parsed.value.untagged : true).toBe(false);
  });

  it("refuses a page larger than the accepted maximum", () => {
    expect(
      parseListTransactionsInput({
        workspaceId: "workspace-1",
        limit: MAX_TRANSACTION_PAGE_SIZE + 1,
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "limit", code: "invalidLimit" }],
    });
  });
});

describe("escapeLikeLiteral", () => {
  it("keeps SQL wildcard characters and the escape marker literal", () => {
    expect(escapeLikeLiteral("100%_off!")).toBe("100!%!_off!!");
  });
});
