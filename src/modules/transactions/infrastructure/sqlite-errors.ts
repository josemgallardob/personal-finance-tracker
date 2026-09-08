/**
 * Translation of SQLite failures into transaction refusals.
 *
 * The constraints of the schema are the authority on identity, on workspace
 * membership and on the compatibility between a movement and its category, so
 * the adapter attempts the write and reads the verdict from the driver instead
 * of checking first and hoping no other writer gets in between.
 */

import "server-only";

/**
 * Reads the extended result code better-sqlite3 puts on its errors.
 *
 * A failure that carries no code did not come from a constraint: a closed
 * connection or a bug raises a plain error, and the caller reports it as an
 * unmodelled storage failure.
 */
export function sqliteErrorCode(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    return String(cause.code);
  }

  return "";
}

/** Tells whether a failed write violated a unique index or a primary key. */
export function isUniqueViolation(cause: unknown): boolean {
  const code = sqliteErrorCode(cause);

  return (
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "SQLITE_CONSTRAINT_PRIMARYKEY"
  );
}

/**
 * Tells whether a failed write violated a foreign key.
 *
 * SQLite does not name the key it refused, so the adapter resolves which
 * reference was missing with a scoped lookup on the failure path only.
 */
export function isForeignKeyViolation(cause: unknown): boolean {
  return sqliteErrorCode(cause) === "SQLITE_CONSTRAINT_FOREIGNKEY";
}

/** Technical detail kept for logs. It never carries personal data. */
export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
