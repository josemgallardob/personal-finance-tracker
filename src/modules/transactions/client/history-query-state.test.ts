import { describe, expect, it } from "vitest";

import {
  emptyHistoryQueryState,
  historyPageHref,
  historyQueryEquals,
  historyQueryRequestKey,
  isHistoryQueryEmpty,
  parseHistoryQueryState,
  toTransactionListQuery,
  uniqueTagIds,
  withoutHistoryChip,
  writeHistoryQueryState,
} from "./history-query-state";

describe("uniqueTagIds", () => {
  it("drops blanks and later duplicates without sorting", () => {
    expect(uniqueTagIds(["b", "", "a", "b", "a"])).toEqual(["b", "a"]);
  });
});

describe("parseHistoryQueryState and writeHistoryQueryState", () => {
  it("round-trips accents, spaces and ampersands through the history URL", () => {
    const href = historyPageHref("all", {
      q: "Café & té",
      type: "expense",
      categoryId: "cat-food",
      tagIds: ["tag-trips", "tag-trips", "tag-home"],
    });
    const url = new URL(href, "http://localhost");

    expect(url.pathname).toBe("/transactions");
    expect(url.searchParams.get("tab")).toBe("all");
    expect(url.searchParams.get("q")).toBe("Café & té");
    expect(url.search).toContain("Caf%C3%A9");
    expect(url.search).toContain("%26");
    expect(url.searchParams.getAll("tagId")).toEqual(["tag-trips", "tag-home"]);
    expect(parseHistoryQueryState(url.searchParams)).toEqual({
      q: "Café & té",
      type: "expense",
      categoryId: "cat-food",
      tagIds: ["tag-trips", "tag-home"],
    });
  });

  it("ignores an unknown type and empty filter keys", () => {
    const params = new URLSearchParams(
      "tab=all&type=transfer&q=&categoryId=&tagId=&tagId=tag-1",
    );
    expect(parseHistoryQueryState(params)).toEqual({
      q: "",
      type: null,
      categoryId: null,
      tagIds: ["tag-1"],
    });
  });

  it("preserves tab while rewriting filters", () => {
    const current = new URLSearchParams("tab=all&dateFrom=2026-08-01");
    const next = writeHistoryQueryState(current, {
      q: "Nómina",
      type: "income",
      categoryId: null,
      tagIds: [],
    });
    expect(next.get("tab")).toBe("all");
    expect(next.get("dateFrom")).toBe("2026-08-01");
    expect(next.get("q")).toBe("Nómina");
    expect(next.get("type")).toBe("income");
    expect(next.has("categoryId")).toBe(false);
  });
});

describe("toTransactionListQuery", () => {
  it("omits empty dimensions and sends tag OR without duplicates", () => {
    expect(toTransactionListQuery(emptyHistoryQueryState)).toEqual({
      q: undefined,
      type: undefined,
      categoryId: undefined,
      tagId: undefined,
    });
    expect(
      toTransactionListQuery({
        q: "pan",
        type: "expense",
        categoryId: "cat-food",
        tagIds: ["t1", "t1", "t2"],
      }),
    ).toEqual({
      q: "pan",
      type: "expense",
      categoryId: "cat-food",
      tagId: ["t1", "t2"],
    });
  });
});

describe("historyQueryRequestKey", () => {
  it("changes when any filter changes so previous pages are discarded", () => {
    const base = historyQueryRequestKey(emptyHistoryQueryState);
    expect(
      historyQueryRequestKey({ ...emptyHistoryQueryState, q: "café" }),
    ).not.toBe(base);
    expect(isHistoryQueryEmpty(emptyHistoryQueryState)).toBe(true);
    expect(
      historyQueryEquals(emptyHistoryQueryState, emptyHistoryQueryState),
    ).toBe(true);
  });
});

describe("withoutHistoryChip", () => {
  it("clears one dimension at a time", () => {
    const state = {
      q: "café",
      type: "expense" as const,
      categoryId: "cat-food",
      tagIds: ["t1", "t2"],
    };
    expect(withoutHistoryChip(state, { kind: "q", label: "x" }).q).toBe("");
    expect(withoutHistoryChip(state, { kind: "type", label: "x" }).type).toBe(
      null,
    );
    expect(
      withoutHistoryChip(state, { kind: "category", label: "x" }).categoryId,
    ).toBe(null);
    expect(
      withoutHistoryChip(state, { kind: "tag", label: "x", tagId: "t1" })
        .tagIds,
    ).toEqual(["t2"]);
  });
});
