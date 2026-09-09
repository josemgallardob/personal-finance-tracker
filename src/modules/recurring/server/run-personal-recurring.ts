/**
 * Process entry of the personal recurrence catch-up.
 *
 * Startup and the operator command share this function. It refuses to open
 * SQLite during a production Next.js build, never prints a path or a driver
 * message, and reports only counts plus a closed set of reason codes.
 */

import "server-only";

import { type Clock } from "../../../shared/domain/clock";
import type { EnvSource } from "../../../shared/server/config";
import {
  type DatabaseErrorCode,
  NEXT_PRODUCTION_BUILD_PHASE,
  closeSqliteConnection,
  getPersonalSqliteConnection,
} from "../../../shared/server/database";
import {
  type RecurringCatchUpCode,
  type RecurringCatchUpSummary,
  catchUpPersonalRecurring,
  formatRecurringCatchUpLog,
} from "../application/run-personal-recurring";

const DATABASE_CODES: ReadonlySet<DatabaseErrorCode> = new Set([
  "buildTimeAccess",
  "invalidConfig",
  "invalidPath",
  "openFailed",
]);

function asCatchUpCode(code: DatabaseErrorCode): RecurringCatchUpCode {
  return DATABASE_CODES.has(code) ? code : "storageFailure";
}

/**
 * Opens the process database, runs catch-up and closes nothing the HTTP
 * pipeline still needs. Startup keeps the connection; the command closes it.
 */
export function runPersonalRecurringCatchUp(
  options: {
    readonly env?: EnvSource;
    readonly clock?: Clock;
    readonly now?: () => number;
    readonly createId?: () => string;
    readonly keepConnectionOpen?: boolean;
    readonly logger?: (line: string) => void;
  } = {},
): RecurringCatchUpSummary {
  const env = options.env ?? process.env;
  const log = options.logger ?? ((line: string) => console.info(line));

  if (env.NEXT_PHASE === NEXT_PRODUCTION_BUILD_PHASE) {
    const skipped: RecurringCatchUpSummary = {
      ok: true,
      generated: 0,
      skipped: 0,
      failed: 0,
      code: "buildTimeAccess",
    };
    log(formatRecurringCatchUpLog(skipped));
    return skipped;
  }

  const opened = getPersonalSqliteConnection(env);

  if (!opened.ok) {
    const summary: RecurringCatchUpSummary = {
      ok: false,
      generated: 0,
      skipped: 0,
      failed: 0,
      code: asCatchUpCode(opened.error.code),
    };
    log(formatRecurringCatchUpLog(summary));
    return summary;
  }

  try {
    const summary = catchUpPersonalRecurring(opened.value, {
      clock: options.clock,
      now: options.now,
      createId: options.createId,
    });
    log(formatRecurringCatchUpLog(summary));
    return summary;
  } finally {
    if (options.keepConnectionOpen !== true) {
      closeSqliteConnection();
    }
  }
}
