import { describe, expect, it } from "vitest";

import type { LocalDate } from "../../../shared/domain/dates";
import {
  MAX_MONTHLY_DAY,
  MIN_MONTHLY_DAY,
  type MonthlyDay,
  isMonthlyDay,
  monthlyDueDate,
  nextDueDateAfter,
  resolveDueSchedule,
} from "./recurrence-calendar";

function day(value: number): MonthlyDay {
  if (!isMonthlyDay(value)) {
    throw new Error(`Expected an accepted monthly day: ${String(value)}`);
  }

  return value;
}

function date(value: string): LocalDate {
  return value as LocalDate;
}

describe("isMonthlyDay", () => {
  it("accepts every ordinal day a month can have", () => {
    expect(isMonthlyDay(MIN_MONTHLY_DAY)).toBe(true);
    expect(isMonthlyDay(15)).toBe(true);
    expect(isMonthlyDay(MAX_MONTHLY_DAY)).toBe(true);
  });

  it("rejects a day outside the accepted range", () => {
    expect(isMonthlyDay(0)).toBe(false);
    expect(isMonthlyDay(-1)).toBe(false);
    expect(isMonthlyDay(32)).toBe(false);
  });

  it("rejects a day that is not an exact whole number", () => {
    expect(isMonthlyDay(15.5)).toBe(false);
    expect(isMonthlyDay(Number.NaN)).toBe(false);
    expect(isMonthlyDay(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("monthlyDueDate", () => {
  it("keeps the chosen day in a month that contains it", () => {
    expect(monthlyDueDate(2026, 1, day(31))).toEqual({
      ok: true,
      value: "2026-01-31",
    });
    expect(monthlyDueDate(2026, 3, day(15))).toEqual({
      ok: true,
      value: "2026-03-15",
    });
  });

  it("clamps the chosen day to the last day of a shorter month", () => {
    expect(monthlyDueDate(2026, 2, day(31))).toEqual({
      ok: true,
      value: "2026-02-28",
    });
    expect(monthlyDueDate(2026, 2, day(30))).toEqual({
      ok: true,
      value: "2026-02-28",
    });
    expect(monthlyDueDate(2026, 4, day(31))).toEqual({
      ok: true,
      value: "2026-04-30",
    });
  });

  it("uses 29 February in a leap year", () => {
    expect(monthlyDueDate(2028, 2, day(31))).toEqual({
      ok: true,
      value: "2028-02-29",
    });
    expect(monthlyDueDate(2028, 2, day(29))).toEqual({
      ok: true,
      value: "2028-02-29",
    });
  });

  it("rejects a month that does not exist", () => {
    expect(monthlyDueDate(2026, 0, day(1))).toEqual({
      ok: false,
      error: "monthOutOfRange",
    });
    expect(monthlyDueDate(2026, 13, day(1))).toEqual({
      ok: false,
      error: "monthOutOfRange",
    });
  });

  it("rejects a year outside the representable range", () => {
    expect(monthlyDueDate(10_000, 1, day(1))).toEqual({
      ok: false,
      error: "yearOutOfRange",
    });
    expect(monthlyDueDate(0, 1, day(1))).toEqual({
      ok: false,
      error: "yearOutOfRange",
    });
  });
});

describe("nextDueDateAfter", () => {
  it("never falls on the activation day itself", () => {
    expect(nextDueDateAfter(date("2026-09-08"), day(8))).toEqual({
      ok: true,
      value: "2026-10-08",
    });
  });

  it("uses the same month when the chosen day is still ahead", () => {
    expect(nextDueDateAfter(date("2026-09-08"), day(20))).toEqual({
      ok: true,
      value: "2026-09-20",
    });
  });

  it("moves to the next month when the chosen day already passed", () => {
    expect(nextDueDateAfter(date("2026-09-20"), day(8))).toEqual({
      ok: true,
      value: "2026-10-08",
    });
  });

  it("clamps day 31 in February and returns to 31 in March", () => {
    const february = nextDueDateAfter(date("2026-01-31"), day(31));

    expect(february).toEqual({ ok: true, value: "2026-02-28" });

    expect(nextDueDateAfter(date("2026-02-28"), day(31))).toEqual({
      ok: true,
      value: "2026-03-31",
    });
  });

  it("keeps the chosen day after a clamped month for day 30 too", () => {
    expect(nextDueDateAfter(date("2026-02-28"), day(30))).toEqual({
      ok: true,
      value: "2026-03-30",
    });
  });

  it("clamps to 29 February in a leap year and returns to 31 in March", () => {
    expect(nextDueDateAfter(date("2028-01-31"), day(31))).toEqual({
      ok: true,
      value: "2028-02-29",
    });
    expect(nextDueDateAfter(date("2028-02-29"), day(31))).toEqual({
      ok: true,
      value: "2028-03-31",
    });
  });

  it("crosses the end of the year", () => {
    expect(nextDueDateAfter(date("2026-12-31"), day(1))).toEqual({
      ok: true,
      value: "2027-01-01",
    });
    expect(nextDueDateAfter(date("2026-12-01"), day(31))).toEqual({
      ok: true,
      value: "2026-12-31",
    });
  });

  it("rejects a date that would leave the representable years", () => {
    expect(nextDueDateAfter(date("9999-12-31"), day(31))).toEqual({
      ok: false,
      error: "yearOutOfRange",
    });
  });
});

describe("resolveDueSchedule", () => {
  it("owes nothing while its next date is still in the future", () => {
    expect(
      resolveDueSchedule(date("2026-10-01"), day(1), date("2026-09-08")),
    ).toEqual({
      ok: true,
      value: { pending: [], nextDueDate: "2026-10-01" },
    });
  });

  it("includes a date that falls exactly today and continues after it", () => {
    expect(
      resolveDueSchedule(date("2026-09-08"), day(8), date("2026-09-08")),
    ).toEqual({
      ok: true,
      value: { pending: ["2026-09-08"], nextDueDate: "2026-10-08" },
    });
  });

  it("recovers every month missed while the application was stopped", () => {
    expect(
      resolveDueSchedule(date("2026-01-31"), day(31), date("2026-04-15")),
    ).toEqual({
      ok: true,
      value: {
        pending: ["2026-01-31", "2026-02-28", "2026-03-31"],
        nextDueDate: "2026-04-30",
      },
    });
  });

  it("never repeats a recovered date", () => {
    const schedule = resolveDueSchedule(
      date("2025-09-30"),
      day(31),
      date("2026-09-08"),
    );

    expect(schedule.ok).toBe(true);

    if (!schedule.ok) {
      return;
    }

    expect(new Set(schedule.value.pending).size).toBe(
      schedule.value.pending.length,
    );
    expect(schedule.value.pending).toHaveLength(12);
    expect(schedule.value.nextDueDate > "2026-09-08").toBe(true);
  });

  it("reports the calendar failure instead of looping past the last year", () => {
    expect(
      resolveDueSchedule(date("9999-12-31"), day(31), date("9999-12-31")),
    ).toEqual({ ok: false, error: "yearOutOfRange" });
  });
});
