/**
 * Translation of SQLite failures into analytics refusals.
 *
 * Analytics only reads, so there is no constraint verdict to interpret here: a
 * failure is either a closed connection or a bug, and both are reported as an
 * unmodelled storage failure with a detail kept for logs.
 */

import "server-only";

/** Technical detail kept for logs. It never carries personal data. */
export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
