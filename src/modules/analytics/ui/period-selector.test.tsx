/**
 * Dashboard period selector.
 *
 * The suite pins that the applied period is announced without relying on
 * colour, that every preset reaches the caller, and that the custom range only
 * leaves the dialog when both months are real and in order. A rejected range
 * keeps the values the owner typed and explains itself next to the field.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MonthKey } from "../../../shared/domain/dates";
import { dashboardCopy } from "./dashboard-copy";
import { PeriodSelector } from "./period-selector";

function renderSelector(
  period: Parameters<typeof PeriodSelector>[0]["value"] = {
    kind: "currentMonth",
  },
) {
  const onChange = vi.fn();
  render(<PeriodSelector onChange={onChange} value={period} />);
  return { onChange };
}

function group() {
  return screen.getByRole("group", { name: dashboardCopy.periodGroupLabel });
}

async function openRangeDialog() {
  await userEvent.click(
    within(group()).getByRole("button", {
      name: new RegExp(dashboardCopy.customMonthRange),
    }),
  );

  return screen.getByRole("dialog", { name: dashboardCopy.monthRangeTitle });
}

function typeMonth(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("PeriodSelector presets", () => {
  it("announces the applied period through the pressed state", () => {
    renderSelector({ kind: "previousMonth" });

    expect(
      screen.getByRole("button", { name: dashboardCopy.previousMonth }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: dashboardCopy.currentMonth }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("reports every preset the owner activates", async () => {
    const { onChange } = renderSelector();

    for (const [label, kind] of [
      [dashboardCopy.previousMonth, "previousMonth"],
      [dashboardCopy.lastThreeMonths, "lastThreeMonths"],
      [dashboardCopy.currentYear, "currentYear"],
      [dashboardCopy.currentMonth, "currentMonth"],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name: label }));
      expect(onChange).toHaveBeenCalledWith({ kind });
    }

    expect(onChange).toHaveBeenCalledTimes(4);
  });
});

describe("PeriodSelector custom range", () => {
  it("applies a range of complete months and closes the dialog", async () => {
    const { onChange } = renderSelector();
    await openRangeDialog();

    typeMonth(dashboardCopy.monthFromLabel, "2026-01");
    typeMonth(dashboardCopy.monthToLabel, "2026-03");
    await userEvent.click(
      screen.getByRole("button", { name: dashboardCopy.monthRangeApply }),
    );

    expect(onChange).toHaveBeenCalledWith({
      kind: "customMonthRange",
      from: "2026-01" as MonthKey,
      to: "2026-03" as MonthKey,
    });
    expect(
      screen.queryByRole("dialog", { name: dashboardCopy.monthRangeTitle }),
    ).not.toBeInTheDocument();
  });

  it("explains both missing months without applying anything", async () => {
    const { onChange } = renderSelector();
    await openRangeDialog();

    await userEvent.click(
      screen.getByRole("button", { name: dashboardCopy.monthRangeApply }),
    );

    expect(screen.getAllByText(dashboardCopy.monthRequired)).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: dashboardCopy.monthRangeTitle }),
    ).toBeInTheDocument();
  });

  it("keeps a reversed range on screen and explains it on the final month", async () => {
    const { onChange } = renderSelector();
    await openRangeDialog();

    typeMonth(dashboardCopy.monthFromLabel, "2026-05");
    typeMonth(dashboardCopy.monthToLabel, "2026-01");
    await userEvent.click(
      screen.getByRole("button", { name: dashboardCopy.monthRangeApply }),
    );

    expect(screen.getByText(dashboardCopy.monthInverted)).toBeVisible();
    expect(screen.getByLabelText(dashboardCopy.monthFromLabel)).toHaveValue(
      "2026-05",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves the applied period untouched when the dialog is cancelled", async () => {
    const { onChange } = renderSelector();
    await openRangeDialog();

    typeMonth(dashboardCopy.monthFromLabel, "2026-01");
    await userEvent.click(
      screen.getByRole("button", { name: dashboardCopy.monthRangeCancel }),
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: dashboardCopy.monthRangeTitle }),
    ).not.toBeInTheDocument();
  });

  it("names the applied range on the trigger and pre-fills the dialog", async () => {
    renderSelector({
      kind: "customMonthRange",
      from: "2026-01" as MonthKey,
      to: "2026-03" as MonthKey,
    });

    const trigger = within(group()).getByRole("button", {
      name: `${dashboardCopy.customMonthRange}: 01/2026 – 03/2026`,
    });
    expect(trigger).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(trigger);

    expect(screen.getByLabelText(dashboardCopy.monthFromLabel)).toHaveValue(
      "2026-01",
    );
    expect(screen.getByLabelText(dashboardCopy.monthToLabel)).toHaveValue(
      "2026-03",
    );
  });
});
