/**
 * Which series the dashboard breakdowns draw.
 *
 * The selection is a visual decision and nothing else: it never reaches the
 * server, never changes a total, an average or a history filter, and only
 * decides which bars of its own dimension appear. Each dimension owns one
 * selection that both the distribution of the period and the monthly average
 * of that dimension read, so a category hidden in one of them is hidden in the
 * other too.
 *
 * Only identifiers are stored in the session of the browser, so personal
 * figures never leave the session.
 *
 * The presence of a stored entry is itself the record of a manual decision.
 * Nothing is written until the owner changes the selection, so a session that
 * has never touched a selector keeps following the catalog — a newly created
 * active classification joins its selection on its own — and a session that has
 * touched it keeps exactly the identifiers it chose, including across a reload.
 */

/** Dimension a selection belongs to. */
export type SeriesDimension = "categories" | "tags";

/** Identifier of the computed untagged group inside the tag selection. */
export const UNTAGGED_SERIES_ID = "untagged";

const STORAGE_PREFIX = "dashboard:series";

/** One option of a selector, as the selection model needs to see it. */
export interface SeriesOption {
  readonly id: string;
  readonly archived?: boolean;
}

/** Anything that behaves like `sessionStorage` for the selection. */
export interface SeriesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Key one selection is stored under.
 *
 * The personal suffix preserves the existing browser-session key across this
 * release.
 */
export function seriesStorageKey(dimension: SeriesDimension): string {
  return `${STORAGE_PREFIX}:${dimension}:personal`;
}

function isIdentifierList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/**
 * Raw entry of one selection, or null when the session has none.
 *
 * The text is returned unparsed so a subscriber can compare it by value: the
 * same stored decision must always produce the same snapshot, or a component
 * reading it would re-render forever.
 */
export function readSeriesEntry(
  storage: SeriesStorage | null,
  key: string,
): string | null {
  if (storage === null) {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Identifiers of a stored entry, or null when there is no usable decision.
 *
 * A stored value that is not a list of identifiers is treated as absent: a
 * corrupted entry must not be able to empty every chart of the dashboard, and
 * the next manual change replaces it.
 */
export function parseSeriesIds(raw: string | null): readonly string[] | null {
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return isIdentifierList(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Identifiers stored for one selection, or null when none were ever stored. */
export function readStoredSeriesIds(
  storage: SeriesStorage | null,
  key: string,
): readonly string[] | null {
  return parseSeriesIds(readSeriesEntry(storage, key));
}

/**
 * Stores the identifiers of one selection.
 *
 * A storage that refuses to write — a private session, or one that is full —
 * only costs the selection its persistence, so the failure is swallowed
 * instead of breaking the dashboard the owner is reading.
 */
export function writeStoredSeriesIds(
  storage: SeriesStorage | null,
  key: string,
  ids: readonly string[],
): void {
  if (storage === null) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify([...ids]));
  } catch {
    return;
  }
}

/**
 * Selection of a session that has not touched this selector.
 *
 * Every active option is selected and every archived one is left out: an
 * archived classification keeps counting in the totals and in the averages, but
 * it does not draw a bar until the owner asks for it.
 */
export function defaultSeriesIds(
  options: readonly SeriesOption[],
): readonly string[] {
  return options
    .filter((option) => !option.archived)
    .map((option) => option.id);
}

/**
 * Identifiers the breakdowns of one dimension must draw.
 *
 * Without a stored decision the selection follows the catalog, so a new active
 * classification appears on its own. With one, it is respected exactly.
 */
export function resolveSeriesIds(
  options: readonly SeriesOption[],
  stored: readonly string[] | null,
): readonly string[] {
  return stored ?? defaultSeriesIds(options);
}

/** Keeps the entries whose identifier the owner is currently showing. */
export function selectedSeries<TEntry extends { readonly id: string }>(
  entries: readonly TEntry[],
  selectedIds: readonly string[],
): readonly TEntry[] {
  const selected = new Set(selectedIds);

  return entries.filter((entry) => selected.has(entry.id));
}
