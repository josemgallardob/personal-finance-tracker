/**
 * Presentation of the dashboard figures.
 *
 * The suite pins the exact EUR and percentage copy, including the smallest
 * amount, a negative balance and a balance of exactly zero, and pins which
 * figures can be opened in the history and which cannot.
 */

import { describe, expect, it } from "vitest";

import { dashboardCopy } from "./dashboard-copy";
import {
  comparisonChangeLabel,
  drillDownHistoryHref,
  formatDateRangeLabel,
  formatPercentHundredths,
  netTone,
  signedSummaryAmount,
  summaryAmount,
  summaryToneClassName,
} from "./summary-presentation";

/** Replaces the narrow no-break spaces produced by Intl with plain spaces. */
function withPlainSpaces(text: string): string {
  return text.replace(/[\u202f\u00a0]/g, " ");
}

const drillDown = {
  dateFrom: "2026-09-01",
  dateTo: "2026-09-08",
  type: null,
  categoryId: null,
  tagIds: [],
  untagged: false,
};

describe("summary amounts", () => {
  it("formats exact minor units as Spanish EUR", () => {
    expect(withPlainSpaces(summaryAmount(1))).toBe("0,01 €");
    expect(withPlainSpaces(summaryAmount(123456))).toBe("1234,56 €");
    expect(withPlainSpaces(summaryAmount(0))).toBe("0,00 €");
  });

  it("makes the sign of a balance visible and leaves zero unsigned", () => {
    expect(withPlainSpaces(signedSummaryAmount(129950))).toBe("+1299,50 €");
    expect(withPlainSpaces(signedSummaryAmount(-129950))).toBe("−1299,50 €");
    expect(withPlainSpaces(signedSummaryAmount(0))).toBe("0,00 €");
  });

  it("colours a balance by its meaning and keeps zero neutral", () => {
    expect(netTone(1)).toBe("income");
    expect(netTone(-1)).toBe("expense");
    expect(netTone(0)).toBe("neutral");
    expect(summaryToneClassName(netTone(1))).toBe("text-income");
    expect(summaryToneClassName(netTone(-1))).toBe("text-expense");
    expect(summaryToneClassName(netTone(0))).toBe("text-text");
  });
});

describe("comparison changes", () => {
  it("formats hundredths of a percent exactly, with a visible sign", () => {
    expect(withPlainSpaces(formatPercentHundredths(2500))).toBe("+25,00 %");
    expect(withPlainSpaces(formatPercentHundredths(-1997))).toBe("−19,97 %");
    expect(withPlainSpaces(formatPercentHundredths(-50))).toBe("−0,50 %");
    expect(withPlainSpaces(formatPercentHundredths(0))).toBe("0,00 %");
    expect(withPlainSpaces(formatPercentHundredths(1234500))).toBe(
      "+12.345,00 %",
    );
  });

  it("says there is no base instead of drawing a change of zero", () => {
    expect(
      comparisonChangeLabel({
        currentMinor: 250000,
        previousMinor: 0,
        deltaMinor: 250000,
        deltaPercent: null,
        reason: "noComparisonBase",
      }),
    ).toBe(dashboardCopy.noComparisonBase);
  });

  it("keeps a real change of zero as zero", () => {
    expect(
      comparisonChangeLabel({
        currentMinor: 0,
        previousMinor: 0,
        deltaMinor: 0,
        deltaPercent: 0,
        reason: null,
      }),
    ).toBe("0,00 %");
  });

  it("states an interval with both civil dates", () => {
    expect(
      formatDateRangeLabel({ start: "2026-09-01", end: "2026-09-08" }),
    ).toBe("01/09/2026 – 08/09/2026");
  });
});

describe("drillDownHistoryHref", () => {
  it("opens the history on the exact dates and type of a figure", () => {
    expect(drillDownHistoryHref({ ...drillDown, type: "expense" })).toBe(
      "/transactions?dateFrom=2026-09-01&dateTo=2026-09-08&type=expense&tab=all",
    );
  });

  it("keeps the category and tags of a breakdown figure", () => {
    expect(
      drillDownHistoryHref({
        ...drillDown,
        type: "expense",
        categoryId: "cat-food",
        tagIds: ["tag-trips"],
      }),
    ).toBe(
      "/transactions?dateFrom=2026-09-01&dateTo=2026-09-08&type=expense&categoryId=cat-food&tagId=tag-trips&tab=all",
    );
  });

  it("refuses to navigate the untagged group the history cannot filter", () => {
    expect(drillDownHistoryHref({ ...drillDown, untagged: true })).toBeNull();
  });

  it("refuses to navigate an interval that is not a civil date", () => {
    expect(
      drillDownHistoryHref({ ...drillDown, dateFrom: "2026-13-01" }),
    ).toBeNull();
    expect(drillDownHistoryHref({ ...drillDown, dateTo: "ayer" })).toBeNull();
  });
});
