/**
 * Period selection rules of the dashboard.
 *
 * The suite pins the query each period produces, the identity that discards a
 * slower answer from the previous selection, and every way a custom range can
 * be rejected before it becomes a request.
 */

import { describe, expect, it } from "vitest";

import type { MonthKey } from "../../../shared/domain/dates";
import type { DashboardPeriod } from "../domain/periods";
import { dashboardCopy } from "./dashboard-copy";
import {
  DEFAULT_DASHBOARD_PERIOD,
  dashboardPeriodLabel,
  dashboardPeriodRequestKey,
  dashboardPresetLabel,
  formatMonthKeyAsSpanish,
  monthRangeInputValues,
  toDashboardSummaryQuery,
  validateMonthRange,
} from "./dashboard-period";

const customRange: DashboardPeriod = {
  kind: "customMonthRange",
  from: "2026-01" as MonthKey,
  to: "2026-03" as MonthKey,
};

describe("dashboard period queries", () => {
  it("opens on the current month", () => {
    expect(DEFAULT_DASHBOARD_PERIOD).toEqual({ kind: "currentMonth" });
  });

  it("sends no month for a preset", () => {
    expect(toDashboardSummaryQuery({ kind: "previousMonth" })).toEqual({
      period: "previousMonth",
    });
  });

  it("sends both months of a custom range", () => {
    expect(toDashboardSummaryQuery(customRange)).toEqual({
      period: "customMonthRange",
      from: "2026-01",
      to: "2026-03",
    });
  });

  it("gives each period its own request identity", () => {
    expect(dashboardPeriodRequestKey({ kind: "currentMonth" })).toBe(
      "analytics:summary?period=currentMonth",
    );
    expect(dashboardPeriodRequestKey(customRange)).toBe(
      "analytics:summary?period=customMonthRange&from=2026-01&to=2026-03",
    );
    expect(dashboardPeriodRequestKey(customRange)).not.toBe(
      dashboardPeriodRequestKey({
        ...customRange,
        to: "2026-04" as MonthKey,
      }),
    );
  });
});

describe("dashboard period labels", () => {
  it("names every preset in Spanish", () => {
    expect(dashboardPresetLabel("currentMonth")).toBe(
      dashboardCopy.currentMonth,
    );
    expect(dashboardPresetLabel("previousMonth")).toBe(
      dashboardCopy.previousMonth,
    );
    expect(dashboardPresetLabel("lastThreeMonths")).toBe(
      dashboardCopy.lastThreeMonths,
    );
    expect(dashboardPresetLabel("currentYear")).toBe(dashboardCopy.currentYear);
    expect(dashboardPeriodLabel({ kind: "currentYear" })).toBe(
      dashboardCopy.currentYear,
    );
  });

  it("names a custom range by its two months", () => {
    expect(dashboardPeriodLabel(customRange)).toBe("01/2026 – 03/2026");
  });

  it("keeps a month it cannot read instead of inventing one", () => {
    expect(formatMonthKeyAsSpanish("2026-13")).toBe("2026-13");
  });

  it("pre-fills the dialog with the applied range and leaves presets empty", () => {
    expect(monthRangeInputValues(customRange)).toEqual({
      from: "2026-01",
      to: "2026-03",
    });
    expect(monthRangeInputValues({ kind: "currentMonth" })).toEqual({
      from: "",
      to: "",
    });
  });
});

describe("validateMonthRange", () => {
  it("accepts two complete months in order", () => {
    expect(validateMonthRange(" 2026-01 ", "2026-03")).toEqual({
      ok: true,
      from: "2026-01",
      to: "2026-03",
    });
  });

  it("accepts a range of a single month", () => {
    expect(validateMonthRange("2026-02", "2026-02")).toEqual({
      ok: true,
      from: "2026-02",
      to: "2026-02",
    });
  });

  it("requires both bounds and reports them together", () => {
    expect(validateMonthRange("", "")).toEqual({
      ok: false,
      fromError: dashboardCopy.monthRequired,
      toError: dashboardCopy.monthRequired,
    });
  });

  it("rejects a month that does not exist", () => {
    expect(validateMonthRange("2026-13", "2026-03")).toEqual({
      ok: false,
      fromError: dashboardCopy.monthInvalid,
      toError: null,
    });
    expect(validateMonthRange("2026-01", "no-es-un-mes")).toEqual({
      ok: false,
      fromError: null,
      toError: dashboardCopy.monthInvalid,
    });
  });

  it("rejects a reversed range on its final month", () => {
    expect(validateMonthRange("2026-05", "2026-01")).toEqual({
      ok: false,
      fromError: null,
      toError: dashboardCopy.monthInverted,
    });
  });
});
