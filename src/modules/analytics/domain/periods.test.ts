import { describe, expect, it } from "vitest";

import {
  type LocalDate,
  type MonthKey,
  parseLocalDate,
  parseMonthKey,
} from "../../../shared/domain/dates";
import {
  AVERAGE_WINDOW_MONTHS,
  DASHBOARD_PERIOD_KINDS,
  EVOLUTION_WINDOW_MONTHS,
  LAST_MONTHS_PRESET_MONTHS,
  type DashboardPeriod,
  averageWindow,
  evolutionWindow,
  resolveComparisonWindow,
  resolvePeriod,
} from "./periods";

function date(text: string): LocalDate {
  const result = parseLocalDate(text);

  if (!result.ok) {
    throw new Error(
      `Expected "${text}" to be a valid date, got ${result.error}`,
    );
  }

  return result.value;
}

function month(text: string): MonthKey {
  const result = parseMonthKey(text);

  if (!result.ok) {
    throw new Error(
      `Expected "${text}" to be a valid month, got ${result.error}`,
    );
  }

  return result.value;
}

function months(...texts: readonly string[]): readonly MonthKey[] {
  return texts.map(month);
}

const currentMonth: DashboardPeriod = { kind: "currentMonth" };
const previousMonth: DashboardPeriod = { kind: "previousMonth" };
const lastThreeMonths: DashboardPeriod = { kind: "lastThreeMonths" };
const currentYear: DashboardPeriod = { kind: "currentYear" };

function customMonthRange(from: string, to: string): DashboardPeriod {
  return { kind: "customMonthRange", from: month(from), to: month(to) };
}

describe("period constants", () => {
  it("offers the five documented dashboard periods in selector order", () => {
    expect(DASHBOARD_PERIOD_KINDS).toEqual([
      "currentMonth",
      "previousMonth",
      "lastThreeMonths",
      "currentYear",
      "customMonthRange",
    ]);
  });

  it("bounds both rolling windows to twelve months and the preset to three", () => {
    expect(EVOLUTION_WINDOW_MONTHS).toBe(12);
    expect(AVERAGE_WINDOW_MONTHS).toBe(12);
    expect(LAST_MONTHS_PRESET_MONTHS).toBe(3);
  });
});

describe("resolvePeriod", () => {
  it.each([
    [
      "current month stops at today instead of at the end of the month",
      currentMonth,
      "2026-03-15",
      "2026-03-01",
      "2026-03-15",
    ],
    [
      "current month on its first day is a single day",
      currentMonth,
      "2026-03-01",
      "2026-03-01",
      "2026-03-01",
    ],
    [
      "current month covers a whole leap February on its last day",
      currentMonth,
      "2024-02-29",
      "2024-02-01",
      "2024-02-29",
    ],
    [
      "previous month covers the closed month before today",
      previousMonth,
      "2026-04-10",
      "2026-03-01",
      "2026-03-31",
    ],
    [
      "previous month crosses the year boundary in January",
      previousMonth,
      "2026-01-15",
      "2025-12-01",
      "2025-12-31",
    ],
    [
      "previous month ends on 29 February of a leap year",
      previousMonth,
      "2024-03-10",
      "2024-02-01",
      "2024-02-29",
    ],
    [
      "previous month ends on 28 February of a common year",
      previousMonth,
      "2026-03-10",
      "2026-02-01",
      "2026-02-28",
    ],
    [
      "last three months excludes the running month",
      lastThreeMonths,
      "2026-04-10",
      "2026-01-01",
      "2026-03-31",
    ],
    [
      "last three months crosses the year boundary",
      lastThreeMonths,
      "2026-02-10",
      "2025-11-01",
      "2026-01-31",
    ],
    [
      "current year starts on 1 January and stops at today",
      currentYear,
      "2026-09-08",
      "2026-01-01",
      "2026-09-08",
    ],
    [
      "current year on 29 February of a leap year stops there",
      currentYear,
      "2024-02-29",
      "2024-01-01",
      "2024-02-29",
    ],
    [
      "current year on 1 January is a single day",
      currentYear,
      "2026-01-01",
      "2026-01-01",
      "2026-01-01",
    ],
    [
      "custom range spans whole months across a year boundary",
      customMonthRange("2025-11", "2026-01"),
      "2026-04-10",
      "2025-11-01",
      "2026-01-31",
    ],
    [
      "custom range of a single leap February ends on the 29th",
      customMonthRange("2024-02", "2024-02"),
      "2026-04-10",
      "2024-02-01",
      "2024-02-29",
    ],
  ])("%s", (_name, period, today, start, end) => {
    expect(resolvePeriod(period, date(today))).toEqual({
      ok: true,
      value: { start: date(start), end: date(end) },
    });
  });

  it("rejects a custom range whose first month is after its last month", () => {
    expect(
      resolvePeriod(customMonthRange("2026-03", "2026-02"), date("2026-04-10")),
    ).toEqual({ ok: false, error: "invalidMonthRange" });
  });

  it.each([
    [
      "previous month before the first supported month",
      previousMonth,
      "0001-01-05",
    ],
    [
      "last three months before the first supported month",
      lastThreeMonths,
      "0001-02-05",
    ],
  ])("rejects %s", (_name, period, today) => {
    expect(resolvePeriod(period, date(today))).toEqual({
      ok: false,
      error: "monthOutOfRange",
    });
  });

  it("still resolves the current month on the first supported month", () => {
    expect(resolvePeriod(currentMonth, date("0001-01-05"))).toEqual({
      ok: true,
      value: { start: date("0001-01-01"), end: date("0001-01-05") },
    });
  });
});

describe("resolveComparisonWindow", () => {
  it.each([
    [
      "current month to 31 March of a common year against a 28-day February",
      currentMonth,
      "2026-03-31",
      ["2026-03-01", "2026-03-31"],
      ["2026-02-01", "2026-02-28"],
    ],
    [
      "current month to 31 March of a leap year against a 29-day February",
      currentMonth,
      "2024-03-31",
      ["2024-03-01", "2024-03-31"],
      ["2024-02-01", "2024-02-29"],
    ],
    [
      "current month to 31 May against a 30-day April",
      currentMonth,
      "2026-05-31",
      ["2026-05-01", "2026-05-31"],
      ["2026-04-01", "2026-04-30"],
    ],
    [
      "current month to 15 March against the same ordinal day of February",
      currentMonth,
      "2026-03-15",
      ["2026-03-01", "2026-03-15"],
      ["2026-02-01", "2026-02-15"],
    ],
    [
      "current month to 30 January against the previous December",
      currentMonth,
      "2026-01-30",
      ["2026-01-01", "2026-01-30"],
      ["2025-12-01", "2025-12-30"],
    ],
    [
      "current month to 29 February of a leap year against a 28-day January end",
      currentMonth,
      "2024-02-29",
      ["2024-02-01", "2024-02-29"],
      ["2024-01-01", "2024-01-29"],
    ],
    [
      "current year to 29 February of a leap year against 28 February",
      currentYear,
      "2024-02-29",
      ["2024-01-01", "2024-02-29"],
      ["2023-01-01", "2023-02-28"],
    ],
    [
      "current year to 8 September against the same interval a year earlier",
      currentYear,
      "2026-09-08",
      ["2026-01-01", "2026-09-08"],
      ["2025-01-01", "2025-09-08"],
    ],
    [
      "current year to 31 March against a leap year of the same length",
      currentYear,
      "2025-03-31",
      ["2025-01-01", "2025-03-31"],
      ["2024-01-01", "2024-03-31"],
    ],
    [
      "previous complete March against a complete common February",
      previousMonth,
      "2026-04-10",
      ["2026-03-01", "2026-03-31"],
      ["2026-02-01", "2026-02-28"],
    ],
    [
      "previous complete March against a complete leap February",
      previousMonth,
      "2024-04-10",
      ["2024-03-01", "2024-03-31"],
      ["2024-02-01", "2024-02-29"],
    ],
    [
      "previous complete February against a complete 31-day January",
      previousMonth,
      "2026-03-10",
      ["2026-02-01", "2026-02-28"],
      ["2026-01-01", "2026-01-31"],
    ],
    [
      "previous complete December against a complete November",
      previousMonth,
      "2026-01-20",
      ["2025-12-01", "2025-12-31"],
      ["2025-11-01", "2025-11-30"],
    ],
    [
      "last three complete months against the three complete months before",
      lastThreeMonths,
      "2026-04-10",
      ["2026-01-01", "2026-03-31"],
      ["2025-10-01", "2025-12-31"],
    ],
    [
      "last three complete months ending in a common February",
      lastThreeMonths,
      "2026-03-10",
      ["2025-12-01", "2026-02-28"],
      ["2025-09-01", "2025-11-30"],
    ],
    [
      "custom range against the immediately preceding block of the same length",
      customMonthRange("2025-11", "2026-01"),
      "2026-04-10",
      ["2025-11-01", "2026-01-31"],
      ["2025-08-01", "2025-10-31"],
    ],
    [
      "custom single leap February against a complete January",
      customMonthRange("2024-02", "2024-02"),
      "2026-04-10",
      ["2024-02-01", "2024-02-29"],
      ["2024-01-01", "2024-01-31"],
    ],
    [
      "custom twelve-month range against the twelve months before",
      customMonthRange("2025-01", "2025-12"),
      "2026-04-10",
      ["2025-01-01", "2025-12-31"],
      ["2024-01-01", "2024-12-31"],
    ],
  ])("compares %s", (_name, period, today, current, previous) => {
    expect(resolveComparisonWindow(period, date(today))).toEqual({
      ok: true,
      value: {
        current: { start: date(current[0]), end: date(current[1]) },
        previous: { start: date(previous[0]), end: date(previous[1]) },
      },
    });
  });

  it("never shortens the current interval when the previous month is shorter", () => {
    const window = resolveComparisonWindow(currentMonth, date("2026-03-31"));

    if (!window.ok) {
      throw new Error(`Expected a comparison window, got ${window.error}`);
    }

    expect(window.value.current.end).toBe("2026-03-31");
    expect(window.value.previous.end).toBe("2026-02-28");
  });

  it.each([
    [
      "the current month of the first supported month",
      currentMonth,
      "0001-01-05",
    ],
    ["the current year of the first supported year", currentYear, "0001-06-05"],
    [
      "a custom range starting in the first supported month",
      customMonthRange("0001-01", "0001-03"),
      "0001-06-05",
    ],
  ])(
    "rejects %s because the previous block is unrepresentable",
    (_name, period, today) => {
      expect(resolveComparisonWindow(period, date(today))).toEqual({
        ok: false,
        error: "monthOutOfRange",
      });
    },
  );

  it("propagates the rejection of an inverted custom range", () => {
    expect(
      resolveComparisonWindow(
        customMonthRange("2026-03", "2026-02"),
        date("2026-04-10"),
      ),
    ).toEqual({ ok: false, error: "invalidMonthRange" });
  });
});

describe("evolutionWindow", () => {
  it("is empty when no movement exists", () => {
    expect(evolutionWindow(date("2026-09-08"), null)).toEqual({
      kind: "empty",
    });
  });

  it("is empty when the first movement is dated after today", () => {
    expect(evolutionWindow(date("2026-09-08"), date("2026-10-01"))).toEqual({
      kind: "empty",
    });
  });

  it("spans the current month alone when history starts this month", () => {
    expect(evolutionWindow(date("2026-09-08"), date("2026-09-01"))).toEqual({
      kind: "months",
      start: month("2026-09"),
      end: month("2026-09"),
      months: months("2026-09"),
      monthCount: 1,
    });
  });

  it("materialises the months without movements inside a short history", () => {
    expect(evolutionWindow(date("2026-02-10"), date("2025-11-20"))).toEqual({
      kind: "months",
      start: month("2025-11"),
      end: month("2026-02"),
      months: months("2025-11", "2025-12", "2026-01", "2026-02"),
      monthCount: 4,
    });
  });

  it("caps a longer history at the current month plus eleven months", () => {
    const window = evolutionWindow(date("2026-09-08"), date("2019-01-15"));

    expect(window).toEqual({
      kind: "months",
      start: month("2025-10"),
      end: month("2026-09"),
      months: months(
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
        "2026-07",
        "2026-08",
        "2026-09",
      ),
      monthCount: EVOLUTION_WINDOW_MONTHS,
    });
  });

  it("keeps exactly twelve months when the history is exactly twelve months old", () => {
    expect(evolutionWindow(date("2026-09-08"), date("2025-10-31"))).toEqual(
      evolutionWindow(date("2026-09-08"), date("2019-01-15")),
    );
  });

  it("crosses a leap February inside the window", () => {
    const window = evolutionWindow(date("2024-03-05"), date("2024-01-31"));

    expect(window).toEqual({
      kind: "months",
      start: month("2024-01"),
      end: month("2024-03"),
      months: months("2024-01", "2024-02", "2024-03"),
      monthCount: 3,
    });
  });

  it("starts at the first supported month without reaching before it", () => {
    expect(evolutionWindow(date("0001-03-10"), date("0001-01-31"))).toEqual({
      kind: "months",
      start: month("0001-01"),
      end: month("0001-03"),
      months: months("0001-01", "0001-02", "0001-03"),
      monthCount: 3,
    });
  });
});

describe("averageWindow", () => {
  it("reports insufficient history when no movement exists", () => {
    expect(averageWindow(date("2026-09-08"), null)).toEqual({
      kind: "insufficientHistory",
    });
  });

  it("reports insufficient history while the first movement month is running", () => {
    expect(averageWindow(date("2026-09-08"), date("2026-09-01"))).toEqual({
      kind: "insufficientHistory",
    });
  });

  it("excludes the first movement month even when it starts on day one", () => {
    expect(averageWindow(date("2026-10-05"), date("2026-09-01"))).toEqual({
      kind: "insufficientHistory",
    });
  });

  it("includes the month after a first movement dated on day one", () => {
    expect(averageWindow(date("2026-11-05"), date("2026-09-01"))).toEqual({
      kind: "months",
      start: month("2026-10"),
      end: month("2026-10"),
      months: months("2026-10"),
      monthCount: 1,
    });
  });

  it("never includes the running month", () => {
    const window = averageWindow(date("2026-09-30"), date("2025-01-15"));

    if (window.kind !== "months") {
      throw new Error("Expected a resolved average window");
    }

    expect(window.end).toBe("2026-08");
    expect(window.months).not.toContain("2026-09");
  });

  it("materialises the months without movements inside a short history", () => {
    expect(averageWindow(date("2026-03-10"), date("2025-11-20"))).toEqual({
      kind: "months",
      start: month("2025-12"),
      end: month("2026-02"),
      months: months("2025-12", "2026-01", "2026-02"),
      monthCount: 3,
    });
  });

  it("caps a history of more than twelve closed months at twelve", () => {
    const window = averageWindow(date("2026-09-08"), date("2019-01-15"));

    expect(window).toEqual({
      kind: "months",
      start: month("2025-09"),
      end: month("2026-08"),
      months: months(
        "2025-09",
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
        "2026-07",
        "2026-08",
      ),
      monthCount: AVERAGE_WINDOW_MONTHS,
    });
  });

  it("keeps exactly twelve months when the history is exactly twelve closed months", () => {
    expect(averageWindow(date("2026-09-08"), date("2025-08-31"))).toEqual(
      averageWindow(date("2026-09-08"), date("2019-01-15")),
    );
  });

  it("includes a leap February in the divisor", () => {
    const window = averageWindow(date("2024-04-30"), date("2023-12-31"));

    expect(window).toEqual({
      kind: "months",
      start: month("2024-01"),
      end: month("2024-03"),
      months: months("2024-01", "2024-02", "2024-03"),
      monthCount: 3,
    });
  });

  it("reports insufficient history when no month has closed at all", () => {
    expect(averageWindow(date("0001-01-31"), date("0001-01-01"))).toEqual({
      kind: "insufficientHistory",
    });
  });

  it("closes the first window on the first supported month", () => {
    expect(averageWindow(date("0001-03-10"), date("0001-01-31"))).toEqual({
      kind: "months",
      start: month("0001-02"),
      end: month("0001-02"),
      months: months("0001-02"),
      monthCount: 1,
    });
  });
});
