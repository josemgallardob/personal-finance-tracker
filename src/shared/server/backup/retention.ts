/**
 * Daily, weekly and monthly retention over tool-owned artifacts.
 *
 * The plan keeps the newest artifact of each of the last 7 UTC days, 4 ISO
 * weeks and 12 months. The three sets overlap on purpose: an artifact kept by
 * one rule is not counted again by another, so a gap in the schedule shortens
 * the retained history instead of silently deleting an older copy that is
 * still the only representative of its week or month.
 *
 * Only artifacts the caller has already recognised as owned reach this
 * function, and only names it received can appear in `remove`.
 */

import "server-only";

/** Number of distinct days kept. */
export const DAILY_RETENTION = 7;

/** Number of distinct ISO weeks kept. */
export const WEEKLY_RETENTION = 4;

/** Number of distinct months kept. */
export const MONTHLY_RETENTION = 12;

const MILLISECONDS_PER_DAY = 86_400_000;

/** Artifact considered by the retention rules. */
export interface RetentionCandidate {
  readonly name: string;
  readonly createdAt: Date;
}

/** Bucket sizes applied by {@link planRetention}. */
export interface RetentionLimits {
  readonly daily: number;
  readonly weekly: number;
  readonly monthly: number;
}

/** Names to keep and names to delete, both subsets of the input. */
export interface RetentionPlan {
  readonly keep: readonly string[];
  readonly remove: readonly string[];
}

/** Retention required by the technical design. */
export const DEFAULT_RETENTION_LIMITS: RetentionLimits = {
  daily: DAILY_RETENTION,
  weekly: WEEKLY_RETENTION,
  monthly: MONTHLY_RETENTION,
};

/**
 * Builds the retention plan for a set of owned artifacts.
 *
 * Ordering is newest first, with the artifact name as a deterministic
 * tie-break, so two artifacts created in the same second produce a stable
 * plan instead of depending on the order the destination listed them.
 */
export function planRetention(
  candidates: readonly RetentionCandidate[],
  limits: RetentionLimits = DEFAULT_RETENTION_LIMITS,
): RetentionPlan {
  const ordered = [...candidates].sort(compareNewestFirst);

  const keep = new Set<string>([
    ...selectBucketRepresentatives(ordered, limits.daily, dayKey),
    ...selectBucketRepresentatives(ordered, limits.weekly, isoWeekKey),
    ...selectBucketRepresentatives(ordered, limits.monthly, monthKey),
  ]);

  return {
    keep: ordered.filter((candidate) => keep.has(candidate.name)).map(name),
    remove: ordered.filter((candidate) => !keep.has(candidate.name)).map(name),
  };
}

function selectBucketRepresentatives(
  ordered: readonly RetentionCandidate[],
  limit: number,
  toKey: (createdAt: Date) => string,
): readonly string[] {
  const representatives = new Map<string, string>();

  for (const candidate of ordered) {
    if (representatives.size === limit) {
      break;
    }

    const key = toKey(candidate.createdAt);

    if (!representatives.has(key)) {
      representatives.set(key, candidate.name);
    }
  }

  return [...representatives.values()];
}

function compareNewestFirst(
  left: RetentionCandidate,
  right: RetentionCandidate,
): number {
  const byInstant = right.createdAt.getTime() - left.createdAt.getTime();

  return byInstant !== 0 ? byInstant : right.name.localeCompare(left.name);
}

function name(candidate: RetentionCandidate): string {
  return candidate.name;
}

function dayKey(createdAt: Date): string {
  return createdAt.toISOString().slice(0, 10);
}

function monthKey(createdAt: Date): string {
  return createdAt.toISOString().slice(0, 7);
}

/**
 * ISO-8601 week key in UTC.
 *
 * The week is identified by the Thursday it contains, which is what makes a
 * backup taken on 1 January belong to the last week of the previous year when
 * the calendar says so.
 */
function isoWeekKey(createdAt: Date): string {
  const thursday = Date.UTC(
    createdAt.getUTCFullYear(),
    createdAt.getUTCMonth(),
    createdAt.getUTCDate() - mondayBasedDay(createdAt.getUTCDay()) + 3,
  );
  const isoYear = new Date(thursday).getUTCFullYear();
  const firstThursday = firstThursdayOf(isoYear);
  const week =
    1 + Math.round((thursday - firstThursday) / (7 * MILLISECONDS_PER_DAY));

  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function firstThursdayOf(isoYear: number): number {
  const fourthOfJanuary = new Date(Date.UTC(isoYear, 0, 4));

  return Date.UTC(
    isoYear,
    0,
    4 - mondayBasedDay(fourthOfJanuary.getUTCDay()) + 3,
  );
}

function mondayBasedDay(sundayBasedDay: number): number {
  return (sundayBasedDay + 6) % 7;
}
