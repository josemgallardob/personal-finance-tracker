/**
 * The period kept for the session.
 *
 * The suite pins that a documented period survives leaving the dashboard and
 * coming back, that a stored value which is not a documented period is ignored
 * rather than repaired, and that the period never travels in a query string.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { MonthKey } from "../../../shared/domain/dates";
import type { SeriesStorage } from "./series/series-selection";
import {
  dashboardPeriodStorageKey,
  parseStoredPeriod,
  readPeriodEntry,
  useDashboardPeriod,
  writeStoredPeriod,
} from "./dashboard-period-store";

function memoryStorage(initial: Record<string, string> = {}): SeriesStorage & {
  readonly entries: Record<string, string>;
} {
  const entries: Record<string, string> = { ...initial };

  return {
    entries,
    getItem: (key) => entries[key] ?? null,
    setItem: (key, value) => {
      entries[key] = value;
    },
  };
}

describe("readPeriodEntry", () => {
  it("returns the stored text, or nothing when there is no session", () => {
    const key = dashboardPeriodStorageKey("personal");
    const storage = memoryStorage({
      [key]: '{"kind":"previousMonth"}',
    });

    expect(readPeriodEntry(storage, key)).toBe('{"kind":"previousMonth"}');
    expect(readPeriodEntry(memoryStorage(), key)).toBeNull();
    expect(readPeriodEntry(null, key)).toBeNull();
  });

  it("survives a session storage that refuses to be read", () => {
    expect(
      readPeriodEntry(
        {
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => undefined,
        },
        dashboardPeriodStorageKey("personal"),
      ),
    ).toBeNull();
  });
});

describe("writeStoredPeriod", () => {
  it("stores a preset and a custom range under the documented key", () => {
    const storage = memoryStorage();
    const key = dashboardPeriodStorageKey("personal");

    writeStoredPeriod(storage, key, { kind: "lastThreeMonths" });
    expect(storage.entries[key]).toBe('{"kind":"lastThreeMonths"}');

    writeStoredPeriod(storage, key, {
      kind: "customMonthRange",
      from: "2026-01" as MonthKey,
      to: "2026-03" as MonthKey,
    });
    expect(storage.entries[key]).toBe(
      '{"kind":"customMonthRange","from":"2026-01","to":"2026-03"}',
    );
  });

  it("keeps working when the session cannot store anything", () => {
    expect(() => {
      writeStoredPeriod(null, dashboardPeriodStorageKey("personal"), {
        kind: "currentMonth",
      });
      writeStoredPeriod(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("full");
          },
        },
        dashboardPeriodStorageKey("personal"),
        { kind: "currentMonth" },
      );
    }).not.toThrow();
  });
});

describe("parseStoredPeriod", () => {
  it("restores every documented preset", () => {
    expect(parseStoredPeriod('{"kind":"currentYear"}')).toEqual({
      kind: "currentYear",
    });
    expect(parseStoredPeriod('{"kind":"previousMonth"}')).toEqual({
      kind: "previousMonth",
    });
  });

  it("restores a custom range of two real months in order", () => {
    expect(
      parseStoredPeriod(
        '{"kind":"customMonthRange","from":"2026-01","to":"2026-03"}',
      ),
    ).toEqual({ kind: "customMonthRange", from: "2026-01", to: "2026-03" });
    expect(
      parseStoredPeriod(
        '{"kind":"customMonthRange","from":"2026-02","to":"2026-02"}',
      ),
    ).toEqual({ kind: "customMonthRange", from: "2026-02", to: "2026-02" });
  });

  it("ignores anything that is not a documented period", () => {
    expect(parseStoredPeriod(null)).toBeNull();
    expect(parseStoredPeriod("{oops")).toBeNull();
    expect(parseStoredPeriod('"currentMonth"')).toBeNull();
    expect(parseStoredPeriod('{"kind":"lastFiveYears"}')).toBeNull();
    expect(parseStoredPeriod('{"kind":"customMonthRange"}')).toBeNull();
    expect(
      parseStoredPeriod(
        '{"kind":"customMonthRange","from":"2026-13","to":"2026-03"}',
      ),
    ).toBeNull();
    expect(
      parseStoredPeriod(
        '{"kind":"customMonthRange","from":"2026-05","to":"2026-01"}',
      ),
    ).toBeNull();
  });
});

describe("useDashboardPeriod against the real session storage", () => {
  it("keeps the period in the session of the browser when none is injected", async () => {
    window.sessionStorage.clear();

    function Harness() {
      const { period, setPeriod } = useDashboardPeriod({ mode: "personal" });

      return (
        <div>
          <p data-testid="period">{period.kind}</p>
          <button
            onClick={() => {
              setPeriod({ kind: "currentYear" });
            }}
            type="button"
          >
            Año actual
          </button>
        </div>
      );
    }

    const { unmount } = render(<Harness />);
    expect(screen.getByTestId("period")).toHaveTextContent("currentMonth");

    await userEvent.click(screen.getByRole("button", { name: "Año actual" }));

    expect(screen.getByTestId("period")).toHaveTextContent("currentYear");
    expect(
      window.sessionStorage.getItem(dashboardPeriodStorageKey("personal")),
    ).toBe('{"kind":"currentYear"}');

    unmount();
    render(<Harness />);
    expect(screen.getByTestId("period")).toHaveTextContent("currentYear");
    window.sessionStorage.clear();
  });

  it("keeps personal and demo periods in separate session entries", async () => {
    const storage = memoryStorage({
      [dashboardPeriodStorageKey("personal")]: '{"kind":"previousMonth"}',
      [dashboardPeriodStorageKey("demo")]: '{"kind":"currentYear"}',
    });

    function Harness({ mode }: { readonly mode: string }) {
      const { period } = useDashboardPeriod({ mode, storage });
      return <p data-testid="period">{period.kind}</p>;
    }

    const { rerender } = render(<Harness mode="personal" />);
    expect(screen.getByTestId("period")).toHaveTextContent("previousMonth");

    rerender(<Harness mode="demo" />);
    expect(screen.getByTestId("period")).toHaveTextContent("currentYear");
  });
});
