/**
 * History filters that explain a dashboard figure.
 *
 * The descriptor is the only bridge between a figure and the movements that
 * compose it, so these cases fix its vocabulary: inclusive civil ends, the
 * optional type and category of the history, the OR list of tags and the
 * untagged flag that cannot travel with a tag.
 */

import { describe, expect, it } from "vitest";

import {
  parseLocalDate,
  parseMonthKey,
  type LocalDate,
  type MonthKey,
} from "../../../shared/domain/dates";
import type { DateRange } from "../domain/periods";
import { toDrillDownDto, toMonthDrillDownDto } from "./drill-down";

function date(text: string): LocalDate {
  const parsed = parseLocalDate(text);

  if (!parsed.ok) {
    throw new Error(`Expected a date: ${parsed.error}`);
  }

  return parsed.value;
}

function month(text: string): MonthKey {
  const parsed = parseMonthKey(text);

  if (!parsed.ok) {
    throw new Error(`Expected a month: ${parsed.error}`);
  }

  return parsed.value;
}

function range(start: string, end: string): DateRange {
  return { start: date(start), end: date(end) };
}

describe("toDrillDownDto", () => {
  it("keeps the inclusive interval and adds no condition of its own", () => {
    expect(toDrillDownDto(range("2026-03-01", "2026-03-14"))).toEqual({
      dateFrom: "2026-03-01",
      dateTo: "2026-03-14",
      type: null,
      categoryId: null,
      tagIds: [],
      untagged: false,
    });
  });

  it("carries the type and the category of a breakdown group", () => {
    expect(
      toDrillDownDto(range("2026-01-01", "2026-02-28"), {
        type: "expense",
        categoryId: "category-1",
      }),
    ).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-02-28",
      type: "expense",
      categoryId: "category-1",
      tagIds: [],
      untagged: false,
    });
  });

  it("asks for one tag without ever asking for untagged movements", () => {
    expect(
      toDrillDownDto(range("2026-03-01", "2026-03-31"), {
        type: "expense",
        tags: { kind: "tag", tagId: "tag-1" },
      }),
    ).toMatchObject({ tagIds: ["tag-1"], untagged: false });
  });

  it("asks for untagged movements without ever naming a tag", () => {
    expect(
      toDrillDownDto(range("2026-03-01", "2026-03-31"), {
        type: "expense",
        tags: { kind: "untagged" },
      }),
    ).toMatchObject({ tagIds: [], untagged: true });
  });

  it("treats an explicit absence of tag conditions as no condition", () => {
    expect(
      toDrillDownDto(range("2026-03-01", "2026-03-31"), {
        tags: { kind: "any" },
      }),
    ).toMatchObject({ tagIds: [], untagged: false });
  });
});

describe("toMonthDrillDownDto", () => {
  it("spans the whole natural month, including a short and a leap February", () => {
    expect(toMonthDrillDownDto(month("2026-02"))).toMatchObject({
      dateFrom: "2026-02-01",
      dateTo: "2026-02-28",
    });
    expect(toMonthDrillDownDto(month("2024-02"))).toMatchObject({
      dateFrom: "2024-02-01",
      dateTo: "2024-02-29",
    });
    expect(toMonthDrillDownDto(month("2026-04"))).toMatchObject({
      dateFrom: "2026-04-01",
      dateTo: "2026-04-30",
    });
    expect(toMonthDrillDownDto(month("2026-12"))).toMatchObject({
      dateFrom: "2026-12-01",
      dateTo: "2026-12-31",
    });
  });

  it("keeps the conditions of the series it belongs to", () => {
    expect(toMonthDrillDownDto(month("2026-03"), { type: "income" })).toEqual({
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
      type: "income",
      categoryId: null,
      tagIds: [],
      untagged: false,
    });
  });
});
