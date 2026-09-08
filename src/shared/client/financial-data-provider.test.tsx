/**
 * AppShell financial revision: mutation success, focus, visibility and poll.
 *
 * Timers, focus and visibility are replaced at the documented environment
 * boundary. The provider never holds financial payloads; interaction tests
 * compose it with {@link useResource} and a fake transport so a failed save
 * keeps the form, a successful one resets accumulated pages, and a hidden
 * tab stops polling.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClientResult } from "./api-client";
import {
  FINANCIAL_DATA_POLL_INTERVAL_MS,
  FinancialDataProvider,
  useFinancialDataRevision,
  type FinancialDataEnvironment,
} from "./financial-data-provider";
import { useResource } from "./use-resource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function okPage(items: readonly string[]): ApiClientResult<readonly string[]> {
  return {
    ok: true,
    noContent: false,
    status: 200,
    requestId: "req-01",
    data: items,
  };
}

interface FakeEnvironment {
  readonly environment: FinancialDataEnvironment;
  visible: boolean;
  readonly intervalHandlers: (() => void)[];
  readonly intervalDurations: number[];
  readonly focusListeners: (() => void)[];
  readonly visibilityListeners: (() => void)[];
  readonly clearedIntervalIds: number[];
  fireFocus(): void;
  fireVisibility(): void;
  tick(): void;
}

function createFakeEnvironment(visible = true): FakeEnvironment {
  const focusListeners: (() => void)[] = [];
  const visibilityListeners: (() => void)[] = [];
  const intervalHandlers: (() => void)[] = [];
  const intervalDurations: number[] = [];
  const clearedIntervalIds: number[] = [];
  let nextIntervalId = 1;
  const fake: FakeEnvironment = {
    visible,
    intervalHandlers,
    intervalDurations,
    focusListeners,
    visibilityListeners,
    clearedIntervalIds,
    fireFocus() {
      for (const listener of [...focusListeners]) {
        listener();
      }
    },
    fireVisibility() {
      for (const listener of [...visibilityListeners]) {
        listener();
      }
    },
    tick() {
      for (const handler of [...intervalHandlers]) {
        handler();
      }
    },
    environment: {
      addFocusListener(listener) {
        focusListeners.push(listener);
      },
      removeFocusListener(listener) {
        const index = focusListeners.indexOf(listener);
        if (index >= 0) {
          focusListeners.splice(index, 1);
        }
      },
      addVisibilityListener(listener) {
        visibilityListeners.push(listener);
      },
      removeVisibilityListener(listener) {
        const index = visibilityListeners.indexOf(listener);
        if (index >= 0) {
          visibilityListeners.splice(index, 1);
        }
      },
      isDocumentVisible() {
        return fake.visible;
      },
      setInterval(handler, intervalMs) {
        intervalHandlers.push(handler);
        intervalDurations.push(intervalMs);
        return nextIntervalId++;
      },
      clearInterval(intervalId) {
        clearedIntervalIds.push(intervalId);
        intervalHandlers.splice(0, intervalHandlers.length);
      },
    },
  };

  return fake;
}

function RevisionProbe() {
  const { revision, refreshEpoch } = useFinancialDataRevision();

  return (
    <p>
      revision:{revision} epoch:{refreshEpoch}
    </p>
  );
}

function MutationForm() {
  const { announceSuccessfulMutation } = useFinancialDataRevision();
  const [concept, setConcept] = useState("Alquiler");
  const [message, setMessage] = useState("borrador");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const submitted = new FormData(event.currentTarget)
          .get("outcome")
          ?.toString();

        if (submitted === "success") {
          announceSuccessfulMutation();
          setMessage("guardado");
          return;
        }

        setMessage("error");
      }}
    >
      <label>
        Concepto
        <input
          name="concept"
          value={concept}
          onChange={(event) => setConcept(event.target.value)}
        />
      </label>
      <input name="outcome" defaultValue="success" />
      <p>formulario:{message}</p>
      <p>valor:{concept}</p>
      <button type="submit">Guardar</button>
    </form>
  );
}

function AccumulatedPages({
  incoming,
}: {
  incoming: readonly string[] | undefined;
}) {
  const [pages, setPages] = useState<string[]>([]);
  const [seenIncoming, setSeenIncoming] = useState<
    readonly string[] | undefined
  >(undefined);

  if (incoming !== seenIncoming && incoming !== undefined) {
    setSeenIncoming(incoming);
    setPages((current) => {
      if (current.length === 0) {
        return [...incoming];
      }

      return [
        ...current,
        ...incoming.filter((item) => !current.includes(item)),
      ];
    });
  }

  return <p>paginas:{pages.join(",") || "ninguna"}</p>;
}

function HistoryPages({
  load,
}: {
  load: (
    requestKey: string,
    signal: AbortSignal,
  ) => Promise<ApiClientResult<readonly string[]>>;
}) {
  const { revision, refreshEpoch } = useFinancialDataRevision();
  const [filter, setFilter] = useState("todos");
  const resource = useResource({
    requestKey: filter,
    revision,
    refreshEpoch,
    load: (signal) => load(filter, signal),
  });

  return (
    <div>
      <button type="button" onClick={() => setFilter("comida")}>
        Filtrar comida
      </button>
      <AccumulatedPages
        key={resource.paginationResetKey}
        incoming={resource.data}
      />
      <p>estado:{resource.status}</p>
    </div>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useFinancialDataRevision", () => {
  it("rejects use outside the AppShell provider", () => {
    expect(() => render(<RevisionProbe />)).toThrow(
      /useFinancialDataRevision must be used within FinancialDataProvider/,
    );
  });
});

describe("FinancialDataProvider", () => {
  it("starts a single visible poll timer and bumps refresh on each tick", () => {
    const fake = createFakeEnvironment(true);
    render(
      <FinancialDataProvider environment={fake.environment}>
        <RevisionProbe />
      </FinancialDataProvider>,
    );

    expect(screen.getByText("revision:0 epoch:0")).toBeVisible();
    expect(fake.intervalHandlers).toHaveLength(1);
    expect(fake.intervalDurations).toEqual([FINANCIAL_DATA_POLL_INTERVAL_MS]);

    act(() => {
      fake.tick();
    });
    expect(screen.getByText("revision:0 epoch:1")).toBeVisible();

    fake.visible = false;
    act(() => {
      fake.tick();
    });
    expect(screen.getByText("revision:0 epoch:1")).toBeVisible();

    fake.visible = true;
    act(() => {
      fake.tick();
    });
    expect(screen.getByText("revision:0 epoch:2")).toBeVisible();
  });

  it("refreshes on focus only while the document is visible", () => {
    const fake = createFakeEnvironment(true);
    render(
      <FinancialDataProvider environment={fake.environment}>
        <RevisionProbe />
      </FinancialDataProvider>,
    );

    act(() => {
      fake.fireFocus();
    });
    expect(screen.getByText("revision:0 epoch:1")).toBeVisible();

    fake.visible = false;
    act(() => {
      fake.fireFocus();
    });
    expect(screen.getByText("revision:0 epoch:1")).toBeVisible();
  });

  it("stops polling while hidden and refreshes once when visible again", () => {
    const fake = createFakeEnvironment(true);
    render(
      <FinancialDataProvider environment={fake.environment}>
        <RevisionProbe />
      </FinancialDataProvider>,
    );

    expect(fake.intervalHandlers).toHaveLength(1);

    fake.visible = false;
    act(() => {
      fake.fireVisibility();
    });
    expect(fake.intervalHandlers).toHaveLength(0);
    expect(fake.clearedIntervalIds).toEqual([1]);
    expect(screen.getByText("revision:0 epoch:0")).toBeVisible();

    act(() => {
      fake.tick();
    });
    expect(screen.getByText("revision:0 epoch:0")).toBeVisible();

    fake.visible = true;
    act(() => {
      fake.fireVisibility();
    });
    expect(screen.getByText("revision:0 epoch:1")).toBeVisible();
    expect(fake.intervalHandlers).toHaveLength(1);

    act(() => {
      fake.tick();
    });
    expect(screen.getByText("revision:0 epoch:2")).toBeVisible();
  });

  it("does not start polling while the document is hidden on mount", () => {
    const fake = createFakeEnvironment(false);
    render(
      <FinancialDataProvider environment={fake.environment}>
        <RevisionProbe />
      </FinancialDataProvider>,
    );

    expect(fake.intervalHandlers).toHaveLength(0);
    fake.tick();
    expect(screen.getByText("revision:0 epoch:0")).toBeVisible();
  });

  it("clears listeners and the timer on unmount so later ticks do nothing", () => {
    const fake = createFakeEnvironment(true);
    const view = render(
      <FinancialDataProvider environment={fake.environment}>
        <RevisionProbe />
      </FinancialDataProvider>,
    );

    view.unmount();

    expect(fake.focusListeners).toHaveLength(0);
    expect(fake.visibilityListeners).toHaveLength(0);
    expect(fake.intervalHandlers).toHaveLength(0);
    expect(fake.clearedIntervalIds).toEqual([1]);

    fake.fireFocus();
    fake.fireVisibility();
    fake.tick();
  });

  it("does not start a second interval when visibility becomes visible twice", () => {
    const fake = createFakeEnvironment(true);
    render(
      <FinancialDataProvider environment={fake.environment}>
        <RevisionProbe />
      </FinancialDataProvider>,
    );

    act(() => {
      fake.fireVisibility();
    });
    expect(fake.intervalHandlers).toHaveLength(1);
    expect(screen.getByText("revision:0 epoch:1")).toBeVisible();
  });

  it("uses window timers, focus and document visibility without an injected environment", () => {
    vi.useFakeTimers();
    const view = render(
      <FinancialDataProvider>
        <RevisionProbe />
      </FinancialDataProvider>,
    );

    expect(screen.getByText("revision:0 epoch:0")).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(FINANCIAL_DATA_POLL_INTERVAL_MS - 1);
    });
    expect(screen.getByText("revision:0 epoch:0")).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("revision:0 epoch:1")).toBeVisible();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByText("revision:0 epoch:2")).toBeVisible();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    act(() => {
      vi.advanceTimersByTime(FINANCIAL_DATA_POLL_INTERVAL_MS * 2);
    });
    expect(screen.getByText("revision:0 epoch:2")).toBeVisible();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByText("revision:0 epoch:2")).toBeVisible();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByText("revision:0 epoch:3")).toBeVisible();

    view.unmount();
    act(() => {
      vi.advanceTimersByTime(FINANCIAL_DATA_POLL_INTERVAL_MS);
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
  });
});

describe("financial data interaction", () => {
  it("announces a successful mutation, keeps a failed form, and resets pages without duplicates", async () => {
    const fake = createFakeEnvironment(true);
    const loads: { filter: string; signal: AbortSignal }[] = [];
    let pageForTodos = ["cafe", "metro"];

    const user = userEvent.setup();
    render(
      <FinancialDataProvider environment={fake.environment}>
        <MutationForm />
        <HistoryPages
          load={(filter, signal) => {
            loads.push({ filter, signal });
            if (filter === "comida") {
              return Promise.resolve(okPage(["pan"]));
            }

            return Promise.resolve(okPage(pageForTodos));
          }}
        />
        <RevisionProbe />
      </FinancialDataProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("paginas:cafe,metro")).toBeVisible();
    });

    await user.clear(screen.getByLabelText("Concepto"));
    await user.type(screen.getByLabelText("Concepto"), "Supermercado");
    const outcome = screen.getByDisplayValue("success");
    await user.clear(outcome);
    await user.type(outcome, "failure");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByText("formulario:error")).toBeVisible();
    expect(screen.getByText("valor:Supermercado")).toBeVisible();
    expect(screen.getByText("revision:0 epoch:0")).toBeVisible();
    expect(screen.getByText("paginas:cafe,metro")).toBeVisible();

    await user.clear(outcome);
    await user.type(outcome, "success");
    pageForTodos = ["cafe", "metro", "supermercado"];
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(screen.getByText("revision:1 epoch:0")).toBeVisible();
    });
    expect(screen.getByText("formulario:guardado")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByText("paginas:cafe,metro,supermercado")).toBeVisible();
    });
    expect(
      screen.getByText("paginas:cafe,metro,supermercado").textContent,
    ).not.toMatch(/cafe,metro,cafe/);
  });

  it("resets accumulated pages when the filter changes and never duplicates them", async () => {
    const fake = createFakeEnvironment(true);
    const user = userEvent.setup();

    render(
      <FinancialDataProvider environment={fake.environment}>
        <HistoryPages
          load={(filter) =>
            Promise.resolve(
              filter === "comida" ? okPage(["pan"]) : okPage(["cafe", "metro"]),
            )
          }
        />
      </FinancialDataProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("paginas:cafe,metro")).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "Filtrar comida" }));

    await waitFor(() => {
      expect(screen.getByText("paginas:pan")).toBeVisible();
    });
    expect(screen.queryByText(/cafe/)).not.toBeInTheDocument();
  });

  it("does not apply a slow previous filter after a later poll epoch", async () => {
    const fake = createFakeEnvironment(true);
    const first = deferred<ApiClientResult<readonly string[]>>();
    const second = deferred<ApiClientResult<readonly string[]>>();
    let calls = 0;
    const signals: AbortSignal[] = [];

    render(
      <FinancialDataProvider environment={fake.environment}>
        <HistoryPages
          load={(_filter, signal) => {
            signals.push(signal);
            calls += 1;
            return calls === 1 ? first.promise : second.promise;
          }}
        />
      </FinancialDataProvider>,
    );

    first.resolve(okPage(["inicial"]));
    await waitFor(() => {
      expect(screen.getByText("paginas:inicial")).toBeVisible();
    });

    act(() => {
      fake.tick();
    });
    await waitFor(() => {
      expect(signals).toHaveLength(2);
    });
    expect(signals[1]?.aborted).toBe(false);

    act(() => {
      fake.tick();
    });
    expect(signals[1]?.aborted).toBe(true);
    await waitFor(() => {
      expect(signals).toHaveLength(3);
    });

    second.resolve(okPage(["inicial"]));

    await waitFor(() => {
      expect(screen.getByText("paginas:inicial")).toBeVisible();
    });
    expect(screen.getByText("paginas:inicial").textContent).toBe(
      "paginas:inicial",
    );
  });

  it("aborts an in-flight load when the shell unmounts", async () => {
    const fake = createFakeEnvironment(true);
    const pending = deferred<ApiClientResult<readonly string[]>>();
    let signal: AbortSignal | undefined;

    const view = render(
      <FinancialDataProvider environment={fake.environment}>
        <HistoryPages
          load={(_filter, next) => {
            signal = next;
            return pending.promise;
          }}
        />
      </FinancialDataProvider>,
    );

    view.unmount();
    expect(signal?.aborted).toBe(true);
    pending.resolve(okPage(["tarde"]));
    await Promise.resolve();
  });
});
