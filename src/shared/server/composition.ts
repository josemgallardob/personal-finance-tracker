/**
 * Per-request server composition.
 *
 * This module owns the documented lifecycle of the process connection and the
 * collaborators a handler needs for one request: the environment map, the
 * SQLite opener, the Madrid clock and the fixed personal application mode.
 * Feature modules import this wiring; they never import route files. Route
 * files call handler factories and never open a database or read a cookie.
 *
 * The connection itself follows the process rules already documented by the
 * database module: at most one process-wide file, opened on first use, never
 * at import time and never during `next build`. Tests replace the opener so
 * each case keeps its own temporary file. Demo mode switching is reserved for
 * a later area, so the mode reported here is always personal.
 */

import "server-only";

import {
  PERSONAL_APPLICATION_MODE,
  type ApplicationMode,
} from "../../modules/preferences/contracts";
import { SystemClock, type Clock } from "../domain/clock";
import {
  getSqliteConnection,
  type DatabaseResult,
  type SqliteConnection,
} from "./database";
import type { EnvSource } from "./config";
import type { ApiHandlerDeps } from "./http/handler";
import type { ApiLogger } from "./http/logging";

/** Collaborators a test may replace when assembling one request. */
export interface ServerCompositionDeps {
  readonly env?: EnvSource;
  readonly openConnection?: (
    source: EnvSource,
  ) => DatabaseResult<SqliteConnection>;
  readonly logger?: ApiLogger;
  readonly now?: () => number;
  readonly createRequestId?: () => string;
  readonly clock?: Clock;
}

/** Connection, clock and mode bound for one handler factory. */
export interface ServerComposition {
  readonly clock: Clock;
  readonly mode: ApplicationMode;
  readonly handlerDeps: ApiHandlerDeps;
}

/**
 * Assembles the collaborators of one request without opening SQLite.
 *
 * Opening the file is deferred to the API pipeline, which calls
 * {@link getSqliteConnection} on first use unless a test supplies another
 * opener. The returned clock is the Madrid system clock unless a test injects
 * a deterministic one.
 */
export function createServerComposition(
  deps: ServerCompositionDeps = {},
): ServerComposition {
  const handlerDeps: ApiHandlerDeps = {
    openConnection: deps.openConnection ?? getSqliteConnection,
    ...(deps.env === undefined ? {} : { env: deps.env }),
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.createRequestId === undefined
      ? {}
      : { createRequestId: deps.createRequestId }),
  };

  return {
    clock: deps.clock ?? new SystemClock(),
    mode: PERSONAL_APPLICATION_MODE,
    handlerDeps,
  };
}
