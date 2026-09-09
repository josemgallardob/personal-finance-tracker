/**
 * Private bind resolution and clean shutdown of the server child process.
 *
 * The bind is loopback unless the operator opts in explicitly, so a
 * misconfigured deployment fails instead of publishing personal finances on
 * every interface. Shutdown is exercised against a real child process: the
 * forwarded signal must stop it and the wrapper must translate that stop into
 * a successful exit code.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

import {
  ALLOW_NON_LOOPBACK_BIND_ENV,
  ALLOW_NON_LOOPBACK_BIND_VALUE,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  FORWARDED_SHUTDOWN_SIGNALS,
  type ForwardedShutdownSignal,
  forwardShutdownSignals,
  formatStartupLog,
  resolveServerBinding,
  resolveServerExitCode,
} from "../../../src/shared/server/startup";

const children: ChildProcess[] = [];

afterEach(() => {
  while (children.length > 0) {
    children.pop()?.kill("SIGKILL");
  }
});

/**
 * Starts a real process that stays alive until a signal reaches it.
 *
 * The child announces itself on stdout, so a forwarded signal is never sent
 * before its own handler is installed.
 */
async function startIdleChild(script: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["-e", `${script}; console.log("ready")`],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  children.push(child);

  await new Promise<void>((resolve) => {
    child.stdout?.once("data", () => {
      resolve();
    });
  });

  return child;
}

function waitForExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

describe("private server binding", () => {
  it("binds loopback when the environment selects no interface", () => {
    expect(resolveServerBinding({})).toEqual({
      ok: true,
      value: {
        host: DEFAULT_SERVER_HOST,
        port: DEFAULT_SERVER_PORT,
        loopback: true,
      },
    });
  });

  it("accepts an explicit loopback host and port", () => {
    expect(resolveServerBinding({ HOST: "::1", PORT: "4321" })).toEqual({
      ok: true,
      value: { host: "::1", port: 4321, loopback: true },
    });
  });

  it("treats an empty host or port as unset", () => {
    expect(resolveServerBinding({ HOST: "  ", PORT: "" })).toEqual({
      ok: true,
      value: {
        host: DEFAULT_SERVER_HOST,
        port: DEFAULT_SERVER_PORT,
        loopback: true,
      },
    });
  });

  it("refuses a non-loopback interface that was not opted into", () => {
    expect(resolveServerBinding({ HOST: "0.0.0.0" })).toEqual({
      ok: false,
      error: "nonLoopbackBindNotAllowed",
    });
    expect(
      resolveServerBinding({
        HOST: "0.0.0.0",
        [ALLOW_NON_LOOPBACK_BIND_ENV]: "yes",
      }),
    ).toEqual({ ok: false, error: "nonLoopbackBindNotAllowed" });
  });

  it("accepts a non-loopback interface only with the explicit opt-in", () => {
    expect(
      resolveServerBinding({
        HOST: "0.0.0.0",
        [ALLOW_NON_LOOPBACK_BIND_ENV]: ALLOW_NON_LOOPBACK_BIND_VALUE,
      }),
    ).toEqual({
      ok: true,
      value: { host: "0.0.0.0", port: DEFAULT_SERVER_PORT, loopback: false },
    });
  });

  it("refuses a host that is not a single token", () => {
    expect(resolveServerBinding({ HOST: "127.0.0.1 8.8.8.8" })).toEqual({
      ok: false,
      error: "invalidHost",
    });
  });

  it("refuses a port that is not a usable TCP port", () => {
    for (const port of ["abc", "-1", "0", "65536", "80.5"]) {
      expect(resolveServerBinding({ PORT: port })).toEqual({
        ok: false,
        error: "invalidPort",
      });
    }
  });

  it("accepts the extreme usable ports", () => {
    expect(resolveServerBinding({ PORT: "1" })).toEqual({
      ok: true,
      value: { host: DEFAULT_SERVER_HOST, port: 1, loopback: true },
    });
    expect(resolveServerBinding({ PORT: "65535" })).toEqual({
      ok: true,
      value: { host: DEFAULT_SERVER_HOST, port: 65_535, loopback: true },
    });
  });

  it("logs one machine-readable line without personal data", () => {
    expect(formatStartupLog({ outcome: "ready", port: 3000 })).toBe(
      '{"event":"server_startup","outcome":"ready","port":3000}',
    );
  });
});

describe("clean shutdown of the server child", () => {
  it.each(FORWARDED_SHUTDOWN_SIGNALS)(
    "forwards %s to the running server",
    async (signal) => {
      const child = await startIdleChild("setInterval(() => {}, 1000)");
      const source = new EventEmitter();

      const shutdown = forwardShutdownSignals(child, {
        on: (forwarded: ForwardedShutdownSignal, listener: () => void) =>
          source.on(forwarded, listener),
      });

      expect(shutdown.requested).toBe(false);

      source.emit(signal);

      const exit = await waitForExit(child);

      expect(shutdown.requested).toBe(true);
      expect(exit.signal).toBe(signal);
      expect(resolveServerExitCode(exit.code, exit.signal, shutdown)).toBe(0);
    },
  );

  it("lets the server finish its own shutdown before reporting", async () => {
    const child = await startIdleChild(
      "process.on('SIGTERM', () => { setTimeout(() => process.exit(0), 50) });" +
        " setInterval(() => {}, 1000)",
    );
    const source = new EventEmitter();

    const shutdown = forwardShutdownSignals(child, {
      on: (forwarded: ForwardedShutdownSignal, listener: () => void) =>
        source.on(forwarded, listener),
    });
    source.emit("SIGTERM");

    const exit = await waitForExit(child);

    expect(exit.code).toBe(0);
    expect(resolveServerExitCode(exit.code, exit.signal, shutdown)).toBe(0);
  });

  it("accepts the conventional signal exit codes of a requested stop", async () => {
    const child = await startIdleChild(
      "process.on('SIGTERM', () => process.exit(143));" +
        " setInterval(() => {}, 1000)",
    );
    const source = new EventEmitter();

    const shutdown = forwardShutdownSignals(child, {
      on: (forwarded: ForwardedShutdownSignal, listener: () => void) =>
        source.on(forwarded, listener),
    });
    source.emit("SIGTERM");

    const exit = await waitForExit(child);

    expect(exit.code).toBe(143);
    expect(resolveServerExitCode(exit.code, exit.signal, shutdown)).toBe(0);
    expect(resolveServerExitCode(130, null, shutdown)).toBe(0);
  });

  it("keeps a signal exit code when no shutdown was requested", () => {
    expect(resolveServerExitCode(143, null)).toBe(143);
    expect(resolveServerExitCode(null, null, { requested: true })).toBe(1);
  });

  it("propagates a failed server exit code", async () => {
    const child = await startIdleChild("setTimeout(() => process.exit(7), 10)");

    const exit = await waitForExit(child);

    expect(resolveServerExitCode(exit.code, exit.signal)).toBe(7);
  });

  it("reports an unexpected termination signal as a failure", async () => {
    const child = await startIdleChild("setInterval(() => {}, 1000)");
    child.kill("SIGKILL");

    const exit = await waitForExit(child);

    expect(exit.signal).toBe("SIGKILL");
    expect(resolveServerExitCode(exit.code, exit.signal)).toBe(1);
  });
});
