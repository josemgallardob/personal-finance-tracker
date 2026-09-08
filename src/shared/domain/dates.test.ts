import { describe, expect, it } from "vitest";

import {
  MAX_SUPPORTED_YEAR,
  MIN_SUPPORTED_YEAR,
  type LocalDate,
  type MonthKey,
  compareLocalDates,
  compareMonthKeys,
  createLocalDate,
  createMonthKey,
  daysInMonth,
  localDateParts,
  monthKeyOf,
  monthKeyParts,
  parseLocalDate,
  parseMonthKey,
} from "./dates";

function parsedDate(text: string): LocalDate {
  const result = parseLocalDate(text);

  if (!result.ok) {
    throw new Error(
      `Expected "${text}" to be a valid date, got ${result.error}`,
    );
  }

  return result.value;
}

function parsedMonth(text: string): MonthKey {
  const result = parseMonthKey(text);

  if (!result.ok) {
    throw new Error(
      `Expected "${text}" to be a valid month, got ${result.error}`,
    );
  }

  return result.value;
}

describe("parseLocalDate", () => {
  it.each([
    "2026-09-06",
    "2024-02-29",
    "2000-02-29",
    "2026-01-01",
    "2026-12-31",
    "2026-04-30",
  ])("accepts the real calendar date %s", (text) => {
    expect(parseLocalDate(text)).toEqual({ ok: true, value: text });
  });

  it.each([
    ["2026-9-6", "unpadded numbers"],
    ["26-09-06", "two-digit year"],
    ["10000-01-01", "year beyond four digits"],
    ["2026/09/06", "wrong separators"],
    ["06/09/2026", "Spanish display format"],
    ["2026-09-06T00:00:00Z", "an instant instead of a civil date"],
    ["2026-09-06 ", "trailing whitespace"],
    [" 2026-09-06", "leading whitespace"],
    ["", "empty text"],
    ["today", "free text"],
    ["2026-09-0a", "non numeric day"],
  ])("rejects %s because of %s", (text) => {
    expect(parseLocalDate(text)).toEqual({
      ok: false,
      error: "invalidFormat",
    });
  });

  it("rejects the year zero and accepts the supported year bounds", () => {
    expect(parseLocalDate("0000-01-01")).toEqual({
      ok: false,
      error: "yearOutOfRange",
    });
    expect(parseLocalDate("0001-01-01")).toEqual({
      ok: true,
      value: "0001-01-01",
    });
    expect(parseLocalDate("9999-12-31")).toEqual({
      ok: true,
      value: "9999-12-31",
    });
    expect(MIN_SUPPORTED_YEAR).toBe(1);
    expect(MAX_SUPPORTED_YEAR).toBe(9999);
  });

  it.each(["2026-00-10", "2026-13-01", "2026-99-01"])(
    "rejects %s because the month does not exist",
    (text) => {
      expect(parseLocalDate(text)).toEqual({
        ok: false,
        error: "monthOutOfRange",
      });
    },
  );

  it.each([
    ["2026-01-00", "day zero"],
    ["2026-01-32", "31-day month"],
    ["2026-04-31", "30-day month"],
    ["2026-06-31", "30-day month"],
    ["2026-09-31", "30-day month"],
    ["2026-11-31", "30-day month"],
    ["2026-02-30", "February"],
    ["2026-02-29", "February of a common year"],
    ["1900-02-29", "February of a century that is not a leap year"],
    ["2026-12-99", "impossible day"],
  ])("rejects %s because the day does not exist in that %s", (text) => {
    expect(parseLocalDate(text)).toEqual({ ok: false, error: "dayOutOfRange" });
  });

  it.each([
    ["2024-02-29", true],
    ["2020-02-29", true],
    ["2000-02-29", true],
    ["1600-02-29", true],
  ])("accepts %s in a leap year", (text) => {
    expect(parseLocalDate(text).ok).toBe(true);
  });

  it.each(["2023-02-29", "2100-02-29", "1900-02-29", "2026-02-29"])(
    "rejects 29 February of the common year in %s",
    (text) => {
      expect(parseLocalDate(text)).toEqual({
        ok: false,
        error: "dayOutOfRange",
      });
    },
  );

  it("accepts 28 February of a common year and 1 March around it", () => {
    expect(parseLocalDate("2023-02-28").ok).toBe(true);
    expect(parseLocalDate("2023-03-01").ok).toBe(true);
  });
});

describe("createLocalDate", () => {
  it("builds a padded date from calendar numbers", () => {
    expect(createLocalDate(2026, 9, 6)).toEqual({
      ok: true,
      value: "2026-09-06",
    });
    expect(createLocalDate(1, 1, 1)).toEqual({ ok: true, value: "0001-01-01" });
  });

  it("applies the same calendar rules as the parser", () => {
    expect(createLocalDate(2024, 2, 29)).toEqual({
      ok: true,
      value: "2024-02-29",
    });
    expect(createLocalDate(2023, 2, 29)).toEqual({
      ok: false,
      error: "dayOutOfRange",
    });
    expect(createLocalDate(2026, 13, 1)).toEqual({
      ok: false,
      error: "monthOutOfRange",
    });
    expect(createLocalDate(0, 1, 1)).toEqual({
      ok: false,
      error: "yearOutOfRange",
    });
  });

  it.each([
    [2026, 9.5, 6],
    [2026, -1, 6],
    [-2026, 9, 6],
    [2026, 9, Number.NaN],
    [12345, 9, 6],
  ])("rejects the unrepresentable numbers %p-%p-%p", (year, month, day) => {
    expect(createLocalDate(year, month, day)).toEqual({
      ok: false,
      error: "invalidFormat",
    });
  });
});

describe("parseMonthKey", () => {
  it.each(["2026-01", "2026-12", "0001-01", "9999-12"])(
    "accepts the real month %s",
    (text) => {
      expect(parseMonthKey(text)).toEqual({ ok: true, value: text });
    },
  );

  it.each(["2026-1", "2026-09-06", "202609", "", "2026/09"])(
    "rejects %s because of its format",
    (text) => {
      expect(parseMonthKey(text)).toEqual({
        ok: false,
        error: "invalidFormat",
      });
    },
  );

  it("rejects the year zero", () => {
    expect(parseMonthKey("0000-01")).toEqual({
      ok: false,
      error: "yearOutOfRange",
    });
  });

  it.each(["2026-00", "2026-13"])(
    "rejects %s because the month does not exist",
    (text) => {
      expect(parseMonthKey(text)).toEqual({
        ok: false,
        error: "monthOutOfRange",
      });
    },
  );
});

describe("createMonthKey", () => {
  it("builds a padded month and rejects impossible values", () => {
    expect(createMonthKey(2026, 9)).toEqual({ ok: true, value: "2026-09" });
    expect(createMonthKey(2026, 0)).toEqual({
      ok: false,
      error: "monthOutOfRange",
    });
    expect(createMonthKey(0, 9)).toEqual({
      ok: false,
      error: "yearOutOfRange",
    });
    expect(createMonthKey(2026, 9.5)).toEqual({
      ok: false,
      error: "invalidFormat",
    });
  });
});

describe("calendar parts", () => {
  it("returns the calendar numbers of a date", () => {
    expect(localDateParts(parsedDate("2026-09-06"))).toEqual({
      year: 2026,
      month: 9,
      day: 6,
    });
    expect(localDateParts(parsedDate("0001-12-31"))).toEqual({
      year: 1,
      month: 12,
      day: 31,
    });
  });

  it("returns the calendar numbers of a month", () => {
    expect(monthKeyParts(parsedMonth("2026-01"))).toEqual({
      year: 2026,
      month: 1,
    });
  });

  it("derives the month a date belongs to", () => {
    expect(monthKeyOf(parsedDate("2026-09-06"))).toBe("2026-09");
    expect(monthKeyOf(parsedDate("2024-02-29"))).toBe("2024-02");
    expect(parseMonthKey(monthKeyOf(parsedDate("2026-12-31"))).ok).toBe(true);
  });
});

describe("compareLocalDates", () => {
  it("orders dates chronologically across days, months and years", () => {
    expect(
      compareLocalDates(parsedDate("2026-09-06"), parsedDate("2026-09-07")),
    ).toBeLessThan(0);
    expect(
      compareLocalDates(parsedDate("2026-10-01"), parsedDate("2026-09-30")),
    ).toBeGreaterThan(0);
    expect(
      compareLocalDates(parsedDate("2027-01-01"), parsedDate("2026-12-31")),
    ).toBeGreaterThan(0);
    expect(
      compareLocalDates(parsedDate("2026-09-06"), parsedDate("2026-09-06")),
    ).toBe(0);
  });

  it("sorts a range in calendar order, not in text length order", () => {
    const dates = ["2026-12-31", "2024-02-29", "2026-01-01", "0999-12-31"].map(
      parsedDate,
    );

    expect([...dates].sort(compareLocalDates)).toEqual([
      "0999-12-31",
      "2024-02-29",
      "2026-01-01",
      "2026-12-31",
    ]);
  });

  it("detects an inverted range without building any instant", () => {
    const from = parsedDate("2026-09-10");
    const to = parsedDate("2026-09-01");

    expect(compareLocalDates(from, to) > 0).toBe(true);
  });
});

describe("compareMonthKeys", () => {
  it("orders months chronologically", () => {
    expect(
      compareMonthKeys(parsedMonth("2026-01"), parsedMonth("2026-02")),
    ).toBeLessThan(0);
    expect(
      compareMonthKeys(parsedMonth("2026-01"), parsedMonth("2025-12")),
    ).toBeGreaterThan(0);
    expect(
      compareMonthKeys(parsedMonth("2026-01"), parsedMonth("2026-01")),
    ).toBe(0);
  });
});

describe("daysInMonth", () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2024, 2, 29],
    [2000, 2, 29],
    [1900, 2, 28],
    [2026, 4, 30],
    [2026, 12, 31],
  ])("reports %i-%i as having %i days", (year, monthNumber, expected) => {
    expect(daysInMonth(year, monthNumber)).toBe(expected);
  });
});
