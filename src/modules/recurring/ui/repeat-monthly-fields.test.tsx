import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import type { RecurringApi } from "../client/recurring-api";
import { RepeatMonthlyFields } from "./repeat-monthly-fields";

function api(preview: RecurringApi["previewNextDueDate"]): RecurringApi {
  return {
    listRules: vi.fn(),
    activateRule: vi.fn(),
    previewNextDueDate: preview,
  };
}

describe("RepeatMonthlyFields", () => {
  it("only reveals and requests the monthly day after its toggle is enabled", async () => {
    const user = userEvent.setup();
    const preview = vi.fn<RecurringApi["previewNextDueDate"]>(() =>
      Promise.resolve({
        ok: true,
        noContent: false,
        status: 200,
        requestId: "request-id",
        data: { nextDueDate: "2026-10-08" },
      }),
    );
    function Harness() {
      const [enabled, setEnabled] = React.useState(false);
      const [day, setDay] = React.useState(8);
      const recurringApi = React.useMemo(() => api(preview), []);
      return (
        <RepeatMonthlyFields
          api={recurringApi}
          enabled={enabled}
          monthlyDay={day}
          onEnabledChange={setEnabled}
          onMonthlyDayChange={setDay}
        />
      );
    }
    render(<Harness />);
    expect(preview).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("checkbox", { name: "Repetir cada mes" }),
    );
    expect(
      await screen.findByText(/La primera copia será el 08\/10\/2026/),
    ).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith({ monthlyDay: 8 }, expect.anything());
  });

  it("aborts an obsolete preview and never renders its stale result", async () => {
    const user = userEvent.setup();
    let firstResolve!: (
      value: Awaited<ReturnType<RecurringApi["previewNextDueDate"]>>,
    ) => void;
    const preview = vi.fn<RecurringApi["previewNextDueDate"]>((body) =>
      body.monthlyDay === 8
        ? new Promise((resolve) => {
            firstResolve = resolve;
          })
        : Promise.resolve({
            ok: true,
            noContent: false,
            status: 200,
            requestId: "request-id",
            data: { nextDueDate: "2026-10-09" },
          }),
    );
    function Harness() {
      const [day, setDay] = React.useState(8);
      const recurringApi = React.useMemo(() => api(preview), []);
      return (
        <RepeatMonthlyFields
          api={recurringApi}
          enabled
          monthlyDay={day}
          onEnabledChange={vi.fn()}
          onMonthlyDayChange={setDay}
        />
      );
    }
    render(<Harness />);
    await user.clear(screen.getByLabelText("Día del mes"));
    await user.type(screen.getByLabelText("Día del mes"), "9");
    firstResolve({
      ok: true,
      noContent: false,
      status: 200,
      requestId: "request-id",
      data: { nextDueDate: "2026-10-08" },
    });
    expect(await screen.findByText(/09\/10\/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/08\/10\/2026/)).not.toBeInTheDocument();
  });
});
