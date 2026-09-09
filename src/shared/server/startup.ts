/**
 * Durable startup sequence for the private single-instance deployment.
 *
 * The process migrates and bootstraps the personal file, migrates the isolated
 * demonstration file, catches up the personal monthly due dates and only then
 * serves requests. Any failed step aborts before the HTTP server exists, so a
 * broken migration can never serve stale or partial data. Nothing here prints
 * a file path, an amount or a concept: steps report their name and a closed
 * reason code.
 */

import "server-only";

import { runPersonalRecurringCatchUp } from "../../modules/recurring/server/run-personal-recurring";
import { type EnvSource } from "./config";
import {
  closeSqliteConnection,
  getDemoSqliteConnection,
  getPersonalSqliteConnection,
} from "./database";
import { initializeDatabase } from "./initialize";

/** Environment variable that selects the interface the server binds to. */
export const SERVER_HOST_ENV = "HOST";

/** Environment variable that selects the TCP port the server listens on. */
export const SERVER_PORT_ENV = "PORT";

/**
 * Environment variable that must be enabled to bind a non-loopback interface.
 *
 * The container sets it because its network namespace is private and the
 * published port is bound to the host loopback address by Compose.
 */
export const ALLOW_NON_LOOPBACK_BIND_ENV = "ALLOW_NON_LOOPBACK_BIND";

/** Value that enables a non-loopback bind. Any other value keeps it refused. */
export const ALLOW_NON_LOOPBACK_BIND_VALUE = "true";

/** Interface used when the environment does not select one. */
export const DEFAULT_SERVER_HOST = "127.0.0.1";

/** Port used when the environment does not select one. */
export const DEFAULT_SERVER_PORT = 3000;

/** Hosts that never leave the machine running the process. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
]);

/** Signals forwarded to the server child so shutdown stays clean. */
export const FORWARDED_SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** Signal accepted by {@link forwardShutdownSignals}. */
export type ForwardedShutdownSignal =
  (typeof FORWARDED_SHUTDOWN_SIGNALS)[number];

/** Reason why the requested binding was refused. */
export type ServerBindingErrorCode =
  "invalidHost" | "invalidPort" | "nonLoopbackBindNotAllowed";

/** Interface and port the server listens on. */
export interface ServerBinding {
  readonly host: string;
  readonly port: number;
  readonly loopback: boolean;
}

/** Outcome of reading the requested binding from the environment. */
export type ServerBindingResult =
  | { readonly ok: true; readonly value: ServerBinding }
  | { readonly ok: false; readonly error: ServerBindingErrorCode };

/** Ordered startup steps executed before the server accepts requests. */
export type StartupStepName =
  "migratePersonal" | "migrateDemo" | "recurringCatchUp";

/** Reason why the startup sequence refused to serve. */
export type StartupFailureCode = "invalidBinding" | "stepFailed";

/** Failed startup, identified by step and closed reason code. */
export interface StartupFailure {
  readonly code: StartupFailureCode;
  readonly step?: StartupStepName;
  readonly reason: string;
}

/** Result of one completed startup step. */
export interface StartupStepReport {
  readonly step: StartupStepName;
  readonly applied?: number;
  readonly createdWorkspace?: boolean;
  readonly generated?: number;
}

/** Outcome of the whole sequence that precedes `next start`. */
export type StartupResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly binding: ServerBinding;
        readonly steps: readonly StartupStepReport[];
      };
    }
  | { readonly ok: false; readonly error: StartupFailure };

/**
 * Reads the interface and port the server must bind to.
 *
 * The default is loopback. A non-loopback interface is only accepted when the
 * operator opts in explicitly, so a misconfigured deployment fails instead of
 * publishing personal finances on every interface of the host.
 */
export function resolveServerBinding(
  source: EnvSource = process.env,
): ServerBindingResult {
  const rawHost = source[SERVER_HOST_ENV]?.trim();
  const host =
    rawHost === undefined || rawHost === "" ? DEFAULT_SERVER_HOST : rawHost;

  if (/\s/.test(host)) {
    return { ok: false, error: "invalidHost" };
  }

  const loopback = LOOPBACK_HOSTS.has(host);

  if (
    !loopback &&
    source[ALLOW_NON_LOOPBACK_BIND_ENV]?.trim() !==
      ALLOW_NON_LOOPBACK_BIND_VALUE
  ) {
    return { ok: false, error: "nonLoopbackBindNotAllowed" };
  }

  const rawPort = source[SERVER_PORT_ENV]?.trim();

  if (rawPort === undefined || rawPort === "") {
    return { ok: true, value: { host, port: DEFAULT_SERVER_PORT, loopback } };
  }

  if (!/^\d+$/.test(rawPort)) {
    return { ok: false, error: "invalidPort" };
  }

  const port = Number.parseInt(rawPort, 10);

  if (port < 1 || port > 65_535) {
    return { ok: false, error: "invalidPort" };
  }

  return { ok: true, value: { host, port, loopback } };
}

/** Serializes a startup event as a single line without personal data. */
export function formatStartupLog(
  event: Record<string, string | number | boolean>,
): string {
  return JSON.stringify({ event: "server_startup", ...event });
}

/**
 * Migrates both databases, bootstraps the personal workspace and recovers
 * missed monthly due dates.
 *
 * Connections opened here are closed before returning, so the caller can hand
 * the files to the server process without holding a write transaction open.
 */
export function prepareServer(
  options: {
    readonly env?: EnvSource;
    readonly logger?: (line: string) => void;
  } = {},
): StartupResult {
  const env = options.env ?? process.env;
  const log = options.logger ?? ((line: string) => console.info(line));

  const binding = resolveServerBinding(env);

  if (!binding.ok) {
    const failure: StartupFailure = {
      code: "invalidBinding",
      reason: binding.error,
    };
    log(formatStartupLog({ outcome: "failed", reason: failure.reason }));
    return { ok: false, error: failure };
  }

  const steps: StartupStepReport[] = [];

  try {
    for (const step of ["migratePersonal", "migrateDemo"] as const) {
      const migrated = migrateDatabase(step, env);

      if (!migrated.ok) {
        log(
          formatStartupLog({
            outcome: "failed",
            step,
            reason: migrated.error.reason,
          }),
        );
        return migrated;
      }

      steps.push(migrated.value);
      log(formatStartupLog({ outcome: "completed", ...migrated.value }));
    }

    const summary = runPersonalRecurringCatchUp({
      env,
      keepConnectionOpen: true,
      logger: log,
    });

    if (!summary.ok) {
      // A failed summary always carries its reason code; the fallback only
      // satisfies the optional field of the shared summary contract.
      const reason = summary.code ?? "storageFailure";
      log(
        formatStartupLog({
          outcome: "failed",
          step: "recurringCatchUp",
          reason,
        }),
      );
      return {
        ok: false,
        error: { code: "stepFailed", step: "recurringCatchUp", reason },
      };
    }

    steps.push({
      step: "recurringCatchUp",
      generated: summary.generated,
    });
  } finally {
    closeSqliteConnection();
  }

  log(
    formatStartupLog({
      outcome: "ready",
      host: binding.value.host,
      port: binding.value.port,
      loopback: binding.value.loopback,
    }),
  );

  return { ok: true, value: { binding: binding.value, steps } };
}

function migrateDatabase(
  step: "migratePersonal" | "migrateDemo",
  env: EnvSource,
):
  | { readonly ok: true; readonly value: StartupStepReport }
  | { readonly ok: false; readonly error: StartupFailure } {
  const opened =
    step === "migratePersonal"
      ? getPersonalSqliteConnection(env)
      : getDemoSqliteConnection(env);

  if (!opened.ok) {
    return {
      ok: false,
      error: { code: "stepFailed", step, reason: opened.error.code },
    };
  }

  const initialized = initializeDatabase(opened.value);

  if (!initialized.ok) {
    return {
      ok: false,
      error: { code: "stepFailed", step, reason: initialized.error.code },
    };
  }

  return {
    ok: true,
    value: {
      step,
      applied: initialized.value.applied.length,
      createdWorkspace: initialized.value.createdWorkspace,
    },
  };
}

/** Child process this module can stop and wait for. */
export interface ShutdownTarget {
  kill(signal: ForwardedShutdownSignal): boolean;
}

/** Source of process signals. The default is the running Node process. */
export interface SignalSource {
  on(signal: ForwardedShutdownSignal, listener: () => void): unknown;
}

/** Records whether the operator asked the server to stop. */
export interface ShutdownState {
  requested: boolean;
}

/**
 * Exit codes a Node process reports when it stops on a forwarded signal.
 *
 * A server that installs its own handler exits with `128 + signal` instead of
 * being reported as signalled, so the wrapper needs both shapes to tell an
 * expected stop from a crash.
 */
const SIGNAL_EXIT_CODES: Readonly<Record<ForwardedShutdownSignal, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

/**
 * Forwards interrupt and termination signals to the server child.
 *
 * Without this the supervisor stops the wrapper and orphans `next start`,
 * which would keep serving and keep SQLite open after the container was asked
 * to stop. The returned state tells the caller that the stop was requested.
 */
export function forwardShutdownSignals(
  child: ShutdownTarget,
  source: SignalSource = process,
): ShutdownState {
  const state: ShutdownState = { requested: false };

  for (const signal of FORWARDED_SHUTDOWN_SIGNALS) {
    source.on(signal, () => {
      state.requested = true;
      child.kill(signal);
    });
  }

  return state;
}

/**
 * Translates the server child exit into the exit code of the wrapper.
 *
 * A child stopped by a shutdown this process requested is a clean stop and
 * reports success, whether the runtime reported the signal or the server
 * translated it into `128 + signal`. Every other exit is propagated as it is,
 * so a crash or a failed start stays visible to the supervisor.
 */
export function resolveServerExitCode(
  code: number | null,
  signal: string | null,
  shutdown: ShutdownState = { requested: false },
): number {
  const forwarded =
    signal !== null &&
    (FORWARDED_SHUTDOWN_SIGNALS as readonly string[]).includes(signal);

  if (shutdown.requested || forwarded) {
    if (code === null) {
      return forwarded ? 0 : 1;
    }

    if (shutdown.requested && Object.values(SIGNAL_EXIT_CODES).includes(code)) {
      return 0;
    }
  }

  return code ?? 1;
}
