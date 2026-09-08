/**
 * Local resource lifecycle: abort, stale discard, refetch and errors.
 *
 * The transport is a fake `load` that records AbortSignals. Promises stay
 * under the test's control so a slow previous filter can resolve after a
 * newer one, which is the race a financial list cannot get wrong.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { ApiClientResult } from "./api-client";
import { useResource } from "./use-resource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function ok(data: string): ApiClientResult<string> {
  return {
    ok: true,
    noContent: false,
    status: 200,
    requestId: "req-01",
    data,
  };
}

function apiError(message: string): ApiClientResult<string> {
  return {
    ok: false,
    reason: "api",
    status: 422,
    error: {
      code: "validationFailed",
      message,
      requestId: "req-err",
    },
  };
}

interface ProbeProps {
  readonly requestKey: string;
  readonly revision?: number;
  readonly refreshEpoch?: number;
  readonly enabled?: boolean;
  readonly load: (signal: AbortSignal) => Promise<ApiClientResult<string>>;
}

function ResourceProbe({
  requestKey,
  revision = 0,
  refreshEpoch = 0,
  enabled = true,
  load,
}: ProbeProps) {
  const resource = useResource({
    load,
    requestKey,
    revision,
    refreshEpoch,
    enabled,
  });

  return (
    <div>
      <p>estado:{resource.status}</p>
      <p>datos:{resource.data ?? "ninguno"}</p>
      <p>error:{resource.error?.reason ?? "ninguno"}</p>
      <p>reinicio:{resource.paginationResetKey}</p>
      <button type="button" onClick={() => resource.refetch()}>
        Recargar
      </button>
    </div>
  );
}

describe("useResource", () => {
  it("loads, then exposes the representation", async () => {
    const pending = deferred<ApiClientResult<string>>();
    const signals: AbortSignal[] = [];

    render(
      <ResourceProbe
        requestKey="all"
        load={(signal) => {
          signals.push(signal);
          return pending.promise;
        }}
      />,
    );

    expect(screen.getByText("estado:loading")).toBeVisible();
    expect(screen.getByText("datos:ninguno")).toBeVisible();

    pending.resolve(ok("enero"));

    await waitFor(() => {
      expect(screen.getByText("estado:ready")).toBeVisible();
    });
    expect(screen.getByText("datos:enero")).toBeVisible();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
  });

  it("does not let a slow previous filter overwrite the current one", async () => {
    const first = deferred<ApiClientResult<string>>();
    const second = deferred<ApiClientResult<string>>();
    const loads: { key: string; signal: AbortSignal }[] = [];

    function FilterProbe() {
      const [filter, setFilter] = useState("old");

      return (
        <div>
          <button type="button" onClick={() => setFilter("new")}>
            Filtrar
          </button>
          <ResourceProbe
            requestKey={filter}
            load={(signal) => {
              loads.push({ key: filter, signal });
              return filter === "old" ? first.promise : second.promise;
            }}
          />
        </div>
      );
    }

    const user = userEvent.setup();
    render(<FilterProbe />);

    await user.click(screen.getByRole("button", { name: "Filtrar" }));

    expect(loads).toHaveLength(2);
    expect(loads[0]?.signal.aborted).toBe(true);
    expect(screen.getByText("datos:ninguno")).toBeVisible();
    expect(screen.getByText("reinicio:new#0")).toBeVisible();

    first.resolve(ok("filtro-antiguo"));
    second.resolve(ok("filtro-nuevo"));

    await waitFor(() => {
      expect(screen.getByText("datos:filtro-nuevo")).toBeVisible();
    });
    expect(screen.queryByText("datos:filtro-antiguo")).not.toBeInTheDocument();
  });

  it("clears the previous filter when the new request is refused", async () => {
    const first = deferred<ApiClientResult<string>>();
    const second = deferred<ApiClientResult<string>>();

    function FilterProbe() {
      const [filter, setFilter] = useState("old");

      return (
        <div>
          <button type="button" onClick={() => setFilter("new")}>
            Filtrar
          </button>
          <ResourceProbe
            requestKey={filter}
            load={() => (filter === "old" ? first.promise : second.promise)}
          />
        </div>
      );
    }

    const user = userEvent.setup();
    render(<FilterProbe />);
    first.resolve(ok("filtro-antiguo"));
    await waitFor(() => {
      expect(screen.getByText("datos:filtro-antiguo")).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "Filtrar" }));
    second.resolve(apiError("El importe no es válido."));

    await waitFor(() => {
      expect(screen.getByText("estado:error")).toBeVisible();
    });
    expect(screen.getByText("datos:ninguno")).toBeVisible();
    expect(screen.getByText("error:api")).toBeVisible();
  });

  it("aborts the in-flight request on unmount and ignores its result", async () => {
    const pending = deferred<ApiClientResult<string>>();
    let signal: AbortSignal | undefined;

    const view = render(
      <ResourceProbe
        requestKey="all"
        load={(next) => {
          signal = next;
          return pending.promise;
        }}
      />,
    );

    view.unmount();

    expect(signal?.aborted).toBe(true);
    pending.resolve(ok("tarde"));
    await Promise.resolve();
  });

  it("does not treat a throw from an aborted load as a network error", async () => {
    let rejectLoad!: (error: Error) => void;
    const pending = new Promise<ApiClientResult<string>>((_, reject) => {
      rejectLoad = reject;
    });
    pending.catch(() => undefined);

    const view = render(
      <ResourceProbe requestKey="all" load={() => pending} />,
    );

    view.unmount();
    rejectLoad(new Error("cancelled"));
    await Promise.resolve();
    await Promise.resolve();
  });

  it("keeps previous data on a background refresh and applies the new one", async () => {
    const first = deferred<ApiClientResult<string>>();
    const second = deferred<ApiClientResult<string>>();
    let calls = 0;

    function RefreshProbe({ epoch }: { epoch: number }) {
      return (
        <ResourceProbe
          requestKey="all"
          refreshEpoch={epoch}
          load={() => {
            calls += 1;
            return calls === 1 ? first.promise : second.promise;
          }}
        />
      );
    }

    const view = render(<RefreshProbe epoch={0} />);
    first.resolve(ok("primera"));
    await waitFor(() => {
      expect(screen.getByText("datos:primera")).toBeVisible();
    });

    view.rerender(<RefreshProbe epoch={1} />);
    expect(screen.getByText("datos:primera")).toBeVisible();

    second.resolve(ok("segunda"));
    await waitFor(() => {
      expect(screen.getByText("datos:segunda")).toBeVisible();
    });
    expect(calls).toBe(2);
  });

  it("aborts an in-flight refresh when a later epoch starts so requests do not overlap", async () => {
    const firstRefresh = deferred<ApiClientResult<string>>();
    const secondRefresh = deferred<ApiClientResult<string>>();
    const signals: AbortSignal[] = [];
    let calls = 0;

    function RefreshProbe({ epoch }: { epoch: number }) {
      return (
        <ResourceProbe
          requestKey="all"
          refreshEpoch={epoch}
          load={(signal) => {
            signals.push(signal);
            calls += 1;
            if (calls === 1) {
              return Promise.resolve(ok("inicial"));
            }

            return calls === 2 ? firstRefresh.promise : secondRefresh.promise;
          }}
        />
      );
    }

    const view = render(<RefreshProbe epoch={0} />);
    await waitFor(() => {
      expect(screen.getByText("datos:inicial")).toBeVisible();
    });

    view.rerender(<RefreshProbe epoch={1} />);
    view.rerender(<RefreshProbe epoch={2} />);

    expect(signals[1]?.aborted).toBe(true);
    firstRefresh.resolve(ok("solapada"));
    secondRefresh.resolve(ok("ultima"));

    await waitFor(() => {
      expect(screen.getByText("datos:ultima")).toBeVisible();
    });
    expect(screen.queryByText("datos:solapada")).not.toBeInTheDocument();
  });

  it("treats a revision change as a pagination reset and a new load", async () => {
    const first = deferred<ApiClientResult<string>>();
    const second = deferred<ApiClientResult<string>>();
    let calls = 0;

    function RevisionProbe({ revision }: { revision: number }) {
      return (
        <ResourceProbe
          requestKey="all"
          revision={revision}
          load={() => {
            calls += 1;
            return calls === 1 ? first.promise : second.promise;
          }}
        />
      );
    }

    const view = render(<RevisionProbe revision={0} />);
    first.resolve(ok("pagina-1"));
    await waitFor(() => {
      expect(screen.getByText("datos:pagina-1")).toBeVisible();
    });
    expect(screen.getByText("reinicio:all#0")).toBeVisible();

    view.rerender(<RevisionProbe revision={1} />);
    expect(screen.getByText("reinicio:all#1")).toBeVisible();
    expect(screen.getByText("datos:ninguno")).toBeVisible();
    expect(screen.getByText("estado:loading")).toBeVisible();

    second.resolve(ok("pagina-1-nueva"));
    await waitFor(() => {
      expect(screen.getByText("datos:pagina-1-nueva")).toBeVisible();
    });
  });

  it("surfaces a load failure without treating abort as an error", async () => {
    const pending = deferred<ApiClientResult<string>>();

    render(<ResourceProbe requestKey="all" load={() => pending.promise} />);

    pending.resolve(apiError("El importe no es válido."));

    await waitFor(() => {
      expect(screen.getByText("estado:error")).toBeVisible();
    });
    expect(screen.getByText("error:api")).toBeVisible();
    expect(screen.getByText("datos:ninguno")).toBeVisible();
  });

  it("keeps showing previous data when a background refresh fails", async () => {
    const first = deferred<ApiClientResult<string>>();
    const second = deferred<ApiClientResult<string>>();
    let calls = 0;

    function RefreshProbe({ epoch }: { epoch: number }) {
      return (
        <ResourceProbe
          requestKey="all"
          refreshEpoch={epoch}
          load={() => {
            calls += 1;
            return calls === 1 ? first.promise : second.promise;
          }}
        />
      );
    }

    const view = render(<RefreshProbe epoch={0} />);
    first.resolve(ok("estable"));
    await waitFor(() => {
      expect(screen.getByText("datos:estable")).toBeVisible();
    });

    view.rerender(<RefreshProbe epoch={1} />);
    second.resolve({ ok: false, reason: "network" });

    await waitFor(() => {
      expect(screen.getByText("estado:error")).toBeVisible();
    });
    expect(screen.getByText("datos:estable")).toBeVisible();
    expect(screen.getByText("error:network")).toBeVisible();
  });

  it("ignores an aborted result instead of showing an error", async () => {
    const pending = deferred<ApiClientResult<string>>();

    render(<ResourceProbe requestKey="all" load={() => pending.promise} />);

    pending.resolve({ ok: false, reason: "aborted" });
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText("estado:loading")).toBeVisible();
    expect(screen.getByText("error:ninguno")).toBeVisible();
  });

  it("refetches on demand and treats a thrown load as a network failure", async () => {
    let calls = 0;
    const first = deferred<ApiClientResult<string>>();

    render(
      <ResourceProbe
        requestKey="all"
        load={() => {
          calls += 1;
          if (calls === 1) {
            return first.promise;
          }

          return Promise.reject(new Error("offline"));
        }}
      />,
    );

    first.resolve(ok("base"));
    await waitFor(() => {
      expect(screen.getByText("datos:base")).toBeVisible();
    });

    await userEvent.click(screen.getByRole("button", { name: "Recargar" }));

    await waitFor(() => {
      expect(screen.getByText("estado:error")).toBeVisible();
    });
    expect(screen.getByText("datos:base")).toBeVisible();
    expect(screen.getByText("error:network")).toBeVisible();
    expect(calls).toBe(2);
  });

  it("does not start a load while disabled and aborts one when disabled later", async () => {
    const pending = deferred<ApiClientResult<string>>();
    let signal: AbortSignal | undefined;
    let calls = 0;

    function EnabledProbe({ enabled }: { enabled: boolean }) {
      return (
        <ResourceProbe
          requestKey="all"
          enabled={enabled}
          load={(next) => {
            calls += 1;
            signal = next;
            return pending.promise;
          }}
        />
      );
    }

    const view = render(<EnabledProbe enabled={false} />);
    expect(calls).toBe(0);

    view.rerender(<EnabledProbe enabled={true} />);
    expect(calls).toBe(1);

    view.rerender(<EnabledProbe enabled={false} />);
    expect(signal?.aborted).toBe(true);

    pending.resolve(ok("ignorar"));
    await Promise.resolve();
    expect(screen.getByText("datos:ninguno")).toBeVisible();
  });

  it("applies an empty successful 204 without inventing a representation", async () => {
    render(
      <ResourceProbe
        requestKey="all"
        load={() =>
          Promise.resolve({
            ok: true,
            noContent: true,
            status: 204,
            requestId: "req-204",
          })
        }
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("estado:ready")).toBeVisible();
    });
    expect(screen.getByText("datos:ninguno")).toBeVisible();
  });
});
