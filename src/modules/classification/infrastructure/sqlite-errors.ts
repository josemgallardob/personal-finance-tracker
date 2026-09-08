/**
 * Translation of SQLite failures into classification refusals.
 *
 * The constraints of the schema are the authority on uniqueness and on the
 * workspace a row belongs to, so the adapters attempt the write and read the
 * verdict from the driver instead of checking first and hoping no other writer
 * gets in between.
 */

import "server-only";

import type { ClassificationRepositoryErrorCode } from "../application/ports/classification-repository";

/**
 * Reads the extended result code better-sqlite3 puts on its errors.
 *
 * A failure that carries no code did not come from a constraint: a closed
 * connection or a bug raises a plain error, and the caller reports it as an
 * unmodelled storage failure.
 */
function sqliteErrorCode(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    return String(cause.code);
  }

  return "";
}

/** Technical detail kept for logs. It never carries personal data. */
export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Column named by SQLite when the violated unique index is the name one. */
const NORMALIZED_NAME_COLUMN = "normalized_name";

/**
 * Maps a failed write to the refusal it means.
 *
 * Both classification tables carry a composite unique index over their
 * identifier and their workspace, so a repeated identifier is reported as a
 * unique violation too. SQLite names the columns of the index it refused, which
 * separates a name already taken by an active row from an identifier that
 * already exists. A violated foreign key is a workspace that does not exist.
 */
export function writeErrorCode(
  cause: unknown,
): ClassificationRepositoryErrorCode {
  switch (sqliteErrorCode(cause)) {
    case "SQLITE_CONSTRAINT_UNIQUE":
      return describeCause(cause).includes(NORMALIZED_NAME_COLUMN)
        ? "duplicateName"
        : "duplicateId";
    case "SQLITE_CONSTRAINT_FOREIGNKEY":
      return "unknownWorkspace";
    default:
      return "storageFailure";
  }
}
