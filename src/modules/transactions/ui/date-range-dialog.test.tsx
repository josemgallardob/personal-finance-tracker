import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseLocalDate } from "../../../shared/domain/dates";
import { HISTORY_LIST_START_ID, historyCopy } from "./history-copy";
import { DateRangeDialog } from "./date-range-dialog";
import { emptyHistoryDateRange } from "./history-date-range";

function localDate(text: string) {
  const parsed = parseLocalDate(text);
  if (!parsed.ok) {
    throw new Error(`expected civil date ${text}`);
  }
  return parsed.value;
}

function stubViewport(isDesktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: isDesktop && query.includes("640px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

beforeEach(() => {
  stubViewport(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DateRangeDialog", () => {
  it("applies a same-day range and focuses the start of the list", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <div id={HISTORY_LIST_START_ID} tabIndex={-1}>
          Lista
        </div>
        <DateRangeDialog onApply={onApply} value={emptyHistoryDateRange} />
      </>,
    );

    await user.click(
      screen.getByRole("button", { name: historyCopy.dateRangeLabel }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: historyCopy.dateRangeTitle,
    });
    expect(
      within(dialog).getByLabelText(historyCopy.dateFromLabel),
    ).toHaveFocus();
    expect(dialog.querySelector("[data-date-range-layout='desktop']")).not.toBe(
      null,
    );

    await user.type(
      within(dialog).getByLabelText(historyCopy.dateFromLabel),
      "01/08/2026",
    );
    await user.type(
      within(dialog).getByLabelText(historyCopy.dateToLabel),
      "01/08/2026",
    );
    await user.click(
      within(dialog).getByRole("button", { name: historyCopy.dateRangeApply }),
    );

    expect(onApply).toHaveBeenCalledWith({
      dateFrom: localDate("2026-08-01"),
      dateTo: localDate("2026-08-01"),
    });
    await waitFor(() => {
      expect(document.getElementById(HISTORY_LIST_START_ID)).toHaveFocus();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps an inverted draft, focuses Desde, and leaves the URL callback unused", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<DateRangeDialog onApply={onApply} value={emptyHistoryDateRange} />);

    await user.click(
      screen.getByRole("button", { name: historyCopy.dateRangeLabel }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(historyCopy.dateFromLabel),
      "02/08/2026",
    );
    await user.type(
      within(dialog).getByLabelText(historyCopy.dateToLabel),
      "01/08/2026",
    );
    await user.click(
      within(dialog).getByRole("button", { name: historyCopy.dateRangeApply }),
    );

    expect(onApply).not.toHaveBeenCalled();
    expect(within(dialog).getAllByText(historyCopy.dateInverted)).toHaveLength(
      2,
    );
    expect(
      within(dialog).getByLabelText(historyCopy.dateFromLabel),
    ).toHaveValue("02/08/2026");
    expect(within(dialog).getByLabelText(historyCopy.dateToLabel)).toHaveValue(
      "01/08/2026",
    );
    expect(
      within(dialog).getByLabelText(historyCopy.dateFromLabel),
    ).toHaveFocus();
  });

  it("does not apply when Cancelar is used after editing", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<DateRangeDialog onApply={onApply} value={emptyHistoryDateRange} />);

    await user.click(
      screen.getByRole("button", { name: historyCopy.dateRangeLabel }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(historyCopy.dateFromLabel),
      "01/08/2026",
    );
    await user.click(
      within(dialog).getByRole("button", { name: historyCopy.dateRangeCancel }),
    );

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("syncs the calendar ISO value and accepts an open From bound", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<DateRangeDialog onApply={onApply} value={emptyHistoryDateRange} />);

    await user.click(
      screen.getByRole("button", { name: historyCopy.dateRangeLabel }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(
      within(dialog).getByLabelText(historyCopy.dateFromCalendar),
      { target: { value: "2026-03-29" } },
    );
    expect(
      within(dialog).getByLabelText(historyCopy.dateFromLabel),
    ).toHaveValue("29/03/2026");
    await user.click(
      within(dialog).getByRole("button", { name: historyCopy.dateRangeApply }),
    );
    expect(onApply).toHaveBeenCalledWith({
      dateFrom: localDate("2026-03-29"),
      dateTo: null,
    });
  });

  it("uses the compact panel layout on a mobile viewport", async () => {
    stubViewport(false);
    const user = userEvent.setup();
    render(<DateRangeDialog onApply={vi.fn()} value={emptyHistoryDateRange} />);

    await user.click(
      screen.getByRole("button", { name: historyCopy.dateRangeLabel }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-date-range-layout='mobile']")).not.toBe(
      null,
    );
  });
});
