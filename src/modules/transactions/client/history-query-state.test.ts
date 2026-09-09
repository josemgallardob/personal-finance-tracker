import { describe, expect, it } from "vitest";

import { parseLocalDate, type LocalDate } from "../../../shared/domain/dates";
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

function civilDate(text: string): LocalDate {
  const parsed = parseLocalDate(text);
  if (!parsed.ok) {
    throw new Error(`expected civil date ${text}`);
  }
  return parsed.value;
}

describe("uniqueTagIds", () => {
  it("drops blanks and later duplicates without sorting", () => {
    expect(uniqueTagIds(["b", "", "a", "b", "a"])).toEqual(["b", "a"]);
  });
});

describe("parseHistoryQueryState and writeHistoryQueryState", () => {
  it("round-trips accents, spaces and ampersands through the history URL", () => {
    const href = historyPageHref("all", {
      q: "Café & té",
      dateFrom: null,
      dateTo: null,
      type: "expense",
      categoryId: "cat-food",
      tagIds: ["tag-trips", "tag-trips", "tag-home"],
      untagged: false,
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
      dateFrom: null,
      dateTo: null,
      type: "expense",
      categoryId: "cat-food",
      tagIds: ["tag-trips", "tag-home"],
      untagged: false,
    });
  });

  it("ignores an unknown type and empty filter keys", () => {
    const params = new URLSearchParams(
      "tab=all&type=transfer&q=&categoryId=&tagId=&tagId=tag-1",
    );
    expect(parseHistoryQueryState(params)).toEqual({
      q: "",
      dateFrom: null,
      dateTo: null,
      type: null,
      categoryId: null,
      tagIds: ["tag-1"],
      untagged: false,
    });
  });

  it("writes inclusive date bounds and ignores an invalid civil date", () => {
    const href = historyPageHref("all", {
      ...emptyHistoryQueryState,
      dateFrom: civilDate("2026-03-29"),
      dateTo: civilDate("2026-03-29"),
      type: "expense",
    });
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get("dateFrom")).toBe("2026-03-29");
    expect(url.searchParams.get("dateTo")).toBe("2026-03-29");
    expect(parseHistoryQueryState(url.searchParams).dateFrom).toBe(
      "2026-03-29",
    );

    expect(
      parseHistoryQueryState(
        new URLSearchParams("dateFrom=not-a-day&dateTo=2026-08-01"),
      ),
    ).toEqual({
      ...emptyHistoryQueryState,
      dateTo: civilDate("2026-08-01"),
    });
  });

  it("preserves tab while rewriting filters", () => {
    const current = new URLSearchParams("tab=all&source=dashboard");
    const next = writeHistoryQueryState(current, {
      ...emptyHistoryQueryState,
      q: "Nómina",
      type: "income",
    });
    expect(next.get("tab")).toBe("all");
    expect(next.get("source")).toBe("dashboard");
    expect(next.get("q")).toBe("Nómina");
    expect(next.get("type")).toBe("income");
    expect(next.has("categoryId")).toBe(false);
    expect(next.has("dateFrom")).toBe(false);
  });
});

describe("toTransactionListQuery", () => {
  it("omits empty dimensions and sends tag OR without duplicates", () => {
    expect(toTransactionListQuery(emptyHistoryQueryState)).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
      q: undefined,
      type: undefined,
      categoryId: undefined,
      tagId: undefined,
    });
    expect(
      toTransactionListQuery({
        ...emptyHistoryQueryState,
        q: "pan",
        dateFrom: civilDate("2026-08-01"),
        type: "expense",
        categoryId: "cat-food",
        tagIds: ["t1", "t1", "t2"],
      }),
    ).toEqual({
      dateFrom: civilDate("2026-08-01"),
      dateTo: undefined,
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
    expect(
      historyQueryRequestKey({
        ...emptyHistoryQueryState,
        dateFrom: civilDate("2026-03-29"),
      }),
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
      ...emptyHistoryQueryState,
      q: "café",
      dateFrom: civilDate("2026-08-01"),
      dateTo: civilDate("2026-08-31"),
      type: "expense" as const,
      categoryId: "cat-food",
      tagIds: ["t1", "t2"],
    };
    expect(withoutHistoryChip(state, { kind: "q", label: "x" }).q).toBe("");
    expect(
      withoutHistoryChip(state, { kind: "dateFrom", label: "x" }).dateFrom,
    ).toBe(null);
    expect(
      withoutHistoryChip(state, { kind: "dateTo", label: "x" }).dateTo,
    ).toBe(null);
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

describe("the computed untagged group in the history URL", () => {
  it("writes and reads the group as its own mutually exclusive filter", () => {
    const href = historyPageHref("all", {
      ...emptyHistoryQueryState,
      dateFrom: civilDate("2026-09-01"),
      dateTo: civilDate("2026-09-30"),
      type: "expense",
      untagged: true,
    });

    expect(href).toBe(
      "/transactions?dateFrom=2026-09-01&dateTo=2026-09-30&type=expense&untagged=true&tab=all",
    );

    const url = new URL(href, "https://finanzas.local");
    expect(parseHistoryQueryState(url.searchParams)).toMatchObject({
      untagged: true,
      tagIds: [],
      type: "expense",
    });
  });

  it("lets an explicit tag win over a group that cannot travel with it", () => {
    const params = new URLSearchParams("untagged=true&tagId=tag-trips");

    expect(parseHistoryQueryState(params)).toMatchObject({
      untagged: false,
      tagIds: ["tag-trips"],
    });

    const written = writeHistoryQueryState(new URLSearchParams(), {
      ...emptyHistoryQueryState,
      tagIds: ["tag-trips"],
      untagged: true,
    });
    expect(written.toString()).toBe("tagId=tag-trips");
  });

  it("ignores any value of the group other than the documented one", () => {
    expect(
      parseHistoryQueryState(new URLSearchParams("untagged=1")).untagged,
    ).toBe(false);
    expect(
      parseHistoryQueryState(new URLSearchParams("untagged=false")).untagged,
    ).toBe(false);
  });

  it("asks the list adapter for the group, and never for both conditions", () => {
    expect(
      toTransactionListQuery({ ...emptyHistoryQueryState, untagged: true }),
    ).toMatchObject({ untagged: true, tagId: undefined });
    expect(
      toTransactionListQuery({
        ...emptyHistoryQueryState,
        tagIds: ["tag-trips"],
        untagged: true,
      }),
    ).toMatchObject({ untagged: undefined, tagId: "tag-trips" });
  });

  it("gives the group its own request identity and its own emptiness", () => {
    const untagged = { ...emptyHistoryQueryState, untagged: true };

    expect(historyQueryRequestKey(untagged)).not.toBe(
      historyQueryRequestKey(emptyHistoryQueryState),
    );
    expect(isHistoryQueryEmpty(untagged)).toBe(false);
    expect(historyQueryEquals(untagged, emptyHistoryQueryState)).toBe(false);
  });

  it("removes the group from the applied filters through its chip", () => {
    expect(
      withoutHistoryChip(
        { ...emptyHistoryQueryState, untagged: true },
        { kind: "untagged", label: "Sin etiquetas" },
      ),
    ).toEqual(emptyHistoryQueryState);
  });
});
