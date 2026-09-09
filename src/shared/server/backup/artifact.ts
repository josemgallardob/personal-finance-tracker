/**
 * Naming rules that identify a backup artifact produced by this tool.
 *
 * Retention must never delete a file that this tool did not create, so an
 * artifact is recognised by an exact name shape plus, at read time, the
 * encrypted header checked in `encryption.ts`. The timestamp is always UTC so
 * that ordering and the daily/weekly/monthly buckets do not depend on the host
 * civil time zone or on a daylight-saving transition.
 */

import "server-only";

/** Fixed prefix of every artifact this tool owns. */
export const ARTIFACT_NAME_PREFIX = "personal-finance-tracker-personal-";

/** Fixed suffix of every artifact this tool owns. */
export const ARTIFACT_NAME_SUFFIX = ".sqlite.enc";

/** Suffix of the in-flight copy written before an upload is committed. */
export const ARTIFACT_PARTIAL_SUFFIX = ".partial";

const ARTIFACT_NAME_PATTERN =
  /^personal-finance-tracker-personal-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.sqlite\.enc$/;

/**
 * Builds the artifact name for an instant, truncated to whole seconds.
 *
 * The name carries no database path, workspace, amount or concept: it only
 * identifies the tool and the instant the snapshot was taken.
 */
export function formatArtifactName(createdAt: Date): string {
  const stamp = [
    pad(createdAt.getUTCFullYear(), 4),
    pad(createdAt.getUTCMonth() + 1, 2),
    pad(createdAt.getUTCDate(), 2),
    "T",
    pad(createdAt.getUTCHours(), 2),
    pad(createdAt.getUTCMinutes(), 2),
    pad(createdAt.getUTCSeconds(), 2),
    "Z",
  ].join("");

  return `${ARTIFACT_NAME_PREFIX}${stamp}${ARTIFACT_NAME_SUFFIX}`;
}

/**
 * Reads the creation instant back from an artifact name.
 *
 * Returns `null` for every name this tool did not produce, including a name
 * with an out-of-range calendar field such as month 13 or 31 February, because
 * the parsed instant must round-trip to the same name.
 */
export function parseArtifactName(name: string): Date | null {
  const match = ARTIFACT_NAME_PATTERN.exec(name);

  if (match === null) {
    return null;
  }

  const [, year, month, day, hours, minutes, seconds] = match.map(Number);
  const createdAt = new Date(
    Date.UTC(year, month - 1, day, hours, minutes, seconds),
  );

  if (formatArtifactName(createdAt) !== name) {
    return null;
  }

  return createdAt;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}
