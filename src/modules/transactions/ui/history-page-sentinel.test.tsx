/**
 * IntersectionObserver fallback at the history sentinel: one intersect burst
 * must not start two page requests; the list hook still gates in-flight work.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistoryPageSentinel } from "./history-page-sentinel";

describe("HistoryPageSentinel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("notifies once per intersecting observer callback burst", async () => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
    }> = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        readonly callback: IntersectionObserverCallback;

        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
          observers.push({ callback });
        }

        disconnect() {}
        observe() {}
        takeRecords() {
          return [];
        }
        unobserve() {}
      },
    );
    const onIntersect = vi.fn();
    render(<HistoryPageSentinel enabled onIntersect={onIntersect} />);
    await screen.findByTestId("history-sentinel");
    expect(observers).toHaveLength(1);

    const intersecting = [
      { isIntersecting: true },
    ] as IntersectionObserverEntry[];
    observers[0]?.callback(intersecting, observers[0] as never);
    observers[0]?.callback(intersecting, observers[0] as never);

    await waitFor(() => {
      expect(onIntersect).toHaveBeenCalledTimes(2);
    });
  });

  it("does not render a sentinel when pagination is disabled", () => {
    render(<HistoryPageSentinel enabled={false} onIntersect={() => {}} />);
    expect(screen.queryByTestId("history-sentinel")).not.toBeInTheDocument();
  });

  it("does not observe when IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const onIntersect = vi.fn();
    render(<HistoryPageSentinel enabled onIntersect={onIntersect} />);
    expect(screen.getByTestId("history-sentinel")).toBeVisible();
    expect(onIntersect).not.toHaveBeenCalled();
  });
});
