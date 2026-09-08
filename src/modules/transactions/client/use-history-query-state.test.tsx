import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const historyNav = vi.hoisted(() => {
  let search = "tab=all";
  let deferred = false;
  const stack: string[] = [];
  const queue: Array<() => void> = [];
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return search;
    },
    push(href: string) {
      const commit = () => {
        stack.push(search);
        search = new URL(href, "http://localhost").searchParams.toString();
        listeners.forEach((listener) => {
          listener();
        });
      };

      if (deferred) {
        queue.push(commit);
        return;
      }

      commit();
    },
    /** Holds every push until {@link settle}, like a slow router commit. */
    defer() {
      deferred = true;
    },
    settle() {
      const pushes = queue.splice(0, queue.length);
      for (const commit of pushes) {
        commit();
      }
    },
    back() {
      const previous = stack.pop();
      if (previous === undefined) {
        return;
      }

      search = previous;
      listeners.forEach((listener) => {
        listener();
      });
    },
    reset() {
      search = "tab=all";
      deferred = false;
      stack.length = 0;
      queue.length = 0;
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/transactions",
  useRouter: () => ({
    push: (href: string) => {
      historyNav.push(href);
    },
    replace: vi.fn(),
  }),
  useSearchParams: () => {
    const search = useSyncExternalStore(
      historyNav.subscribe,
      historyNav.getSnapshot,
      historyNav.getSnapshot,
    );
    return new URLSearchParams(search);
  },
}));

import { emptyHistoryQueryState } from "./history-query-state";
import { useHistoryQueryState } from "./use-history-query-state";

afterEach(() => {
  historyNav.reset();
});

function QueryProbe() {
  const { state, setState, tab } = useHistoryQueryState();

  return (
    <div>
      <p>{`tab:${tab}`}</p>
      <p>{`q:${state.q}`}</p>
      <p>{`type:${state.type ?? ""}`}</p>
      <p>{`tags:${state.tagIds.join(",")}`}</p>
      <button
        onClick={() => {
          setState({
            ...emptyHistoryQueryState,
            q: "Café & té",
            type: "expense",
            categoryId: null,
            tagIds: ["tag-trips", "tag-trips", "tag-home"],
          });
        }}
        type="button"
      >
        Aplicar filtros
      </button>
      <button
        onClick={() => {
          setState(emptyHistoryQueryState);
        }}
        type="button"
      >
        Quitar todos
      </button>
      <button
        onClick={() => {
          setState({ ...state, type: "expense" });
        }}
        type="button"
      >
        Solo gastos
      </button>
      <button
        onClick={() => {
          historyNav.back();
        }}
        type="button"
      >
        Atrás
      </button>
    </div>
  );
}

describe("useHistoryQueryState", () => {
  it("pushes encoded filters and restores them on back", async () => {
    const user = userEvent.setup();
    render(<QueryProbe />);

    expect(screen.getByText("tab:all")).toBeVisible();
    expect(screen.getByText("q:")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));

    expect(screen.getByText("q:Café & té")).toBeVisible();
    expect(screen.getByText("type:expense")).toBeVisible();
    expect(screen.getByText("tags:tag-trips,tag-home")).toBeVisible();
    expect(historyNav.getSnapshot()).toContain("Caf%C3%A9");
    expect(historyNav.getSnapshot()).toContain("%26");
    expect(historyNav.getSnapshot()).toContain("tagId=tag-trips");
    expect(historyNav.getSnapshot()).toContain("tagId=tag-home");
    expect(historyNav.getSnapshot()).not.toMatch(
      /tagId=tag-trips.*tagId=tag-trips/,
    );

    const encoded = historyNav.getSnapshot();
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(historyNav.getSnapshot()).toBe(encoded);

    await user.click(screen.getByRole("button", { name: "Quitar todos" }));
    expect(screen.getByText("q:")).toBeVisible();
    expect(screen.getByText("type:")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Atrás" }));
    expect(screen.getByText("q:Café & té")).toBeVisible();
    expect(screen.getByText("type:expense")).toBeVisible();
    expect(screen.getByText("tags:tag-trips,tag-home")).toBeVisible();
  });

  it("composes a change made while the router has not committed the previous one", async () => {
    const user = userEvent.setup();
    render(<QueryProbe />);

    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(screen.getByText("q:Café & té")).toBeVisible();

    historyNav.defer();
    await user.click(screen.getByRole("button", { name: "Quitar todos" }));

    // The router still reports the previous URL, so only the requested filters
    // can tell the next change what it must compose on.
    expect(historyNav.getSnapshot()).toContain("Caf%C3%A9");
    expect(screen.getByText("q:")).toBeVisible();
    expect(screen.getByText("tags:")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Solo gastos" }));
    act(() => {
      historyNav.settle();
    });

    expect(screen.getByText("q:")).toBeVisible();
    expect(screen.getByText("type:expense")).toBeVisible();
    expect(screen.getByText("tags:")).toBeVisible();
    expect(historyNav.getSnapshot()).toBe("tab=all&type=expense");
  });

  it("keeps the committed URL when a pending change is undone", async () => {
    const user = userEvent.setup();
    render(<QueryProbe />);

    historyNav.defer();
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(screen.getByText("q:Café & té")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Quitar todos" }));
    act(() => {
      historyNav.settle();
    });

    expect(screen.getByText("q:")).toBeVisible();
    expect(screen.getByText("type:")).toBeVisible();
    expect(historyNav.getSnapshot()).toBe("tab=all");
  });
});
