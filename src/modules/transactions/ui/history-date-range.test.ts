import { describe, expect, it } from "vitest";

import { parseLocalDate } from "../../../shared/domain/dates";
import { historyCopy } from "./history-copy";
import {
  historyDateCalendarValue,
  parseHistoryDateText,
  validateHistoryDateRange,
} from "./history-date-range";

function localDate(text: string) {
  const parsed = parseLocalDate(text);
  if (!parsed.ok) {
    throw new Error(`expected civil date ${text}`);
  }
  return parsed.value;
}

describe("parseHistoryDateText", () => {
  it("keeps DST transition days as civil dates without building an instant", () => {
    expect(parseHistoryDateText("29/03/2026")).toEqual({
      ok: true,
      value: localDate("2026-03-29"),
    });
    expect(parseHistoryDateText("2026-10-25")).toEqual({
      ok: true,
      value: localDate("2026-10-25"),
    });
    expect(historyDateCalendarValue("29/03/2026")).toBe("2026-03-29");
    expect(parseHistoryDateText("")).toEqual({ ok: true, value: null });
  });
});

describe("validateHistoryDateRange", () => {
  it("accepts the same inclusive day and a single open bound", () => {
    expect(validateHistoryDateRange("01/08/2026", "01/08/2026")).toEqual({
      ok: true,
      value: {
        dateFrom: localDate("2026-08-01"),
        dateTo: localDate("2026-08-01"),
      },
    });
    expect(validateHistoryDateRange("01/08/2026", "")).toEqual({
      ok: true,
      value: { dateFrom: localDate("2026-08-01"), dateTo: null },
    });
    expect(validateHistoryDateRange("", "01/08/2026")).toEqual({
      ok: true,
      value: { dateFrom: null, dateTo: localDate("2026-08-01") },
    });
  });

  it("keeps inverted values visible through field errors", () => {
    expect(validateHistoryDateRange("02/08/2026", "01/08/2026")).toEqual({
      ok: false,
      fromError: historyCopy.dateInverted,
      toError: historyCopy.dateInverted,
    });
  });
});
