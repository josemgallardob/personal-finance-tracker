/**
 * Selection model of the drawn series.
 *
 * The suite pins the rules the selectors are built on: only identifiers are
 * stored, each application mode owns its own entry, a session that never
 * touched a selector follows the catalog and leaves archived classifications
 * out, and a stored decision survives unchanged. A storage that cannot be read
 * or written costs the selection its persistence and nothing else.
 */

import { describe, expect, it, vi } from "vitest";

import {
  UNTAGGED_SERIES_ID,
  defaultSeriesIds,
  readSeriesEntry,
  readStoredSeriesIds,
  resolveSeriesIds,
  selectedSeries,
  seriesStorageKey,
  writeStoredSeriesIds,
  type SeriesStorage,
} from "./series-selection";

function memoryStorage(initial: Record<string, string> = {}): SeriesStorage & {
  readonly entries: Record<string, string>;
} {
  const entries: Record<string, string> = { ...initial };

  return {
    entries,
    getItem: (key) => entries[key] ?? null,
    setItem: (key, value) => {
      entries[key] = value;
    },
  };
}

const options = [
  { id: "cat-food" },
  { id: "cat-old", archived: true },
  { id: "cat-home" },
];

describe("seriesStorageKey", () => {
  it("keeps every dimension and every mode in its own entry", () => {
    expect(seriesStorageKey("categories", "personal")).toBe(
      "dashboard:series:categories:personal",
    );
    expect(seriesStorageKey("tags", "personal")).not.toBe(
      seriesStorageKey("categories", "personal"),
    );
    expect(seriesStorageKey("tags", "demo")).not.toBe(
      seriesStorageKey("tags", "personal"),
    );
  });
});

describe("readStoredSeriesIds", () => {
  it("reports no decision when the session has never stored one", () => {
    expect(readStoredSeriesIds(memoryStorage(), "any-key")).toBeNull();
    expect(readStoredSeriesIds(null, "any-key")).toBeNull();
  });

  it("returns the identifiers of a stored decision, empty ones included", () => {
    const storage = memoryStorage({
      "dashboard:series:tags:personal": '["tag-trips",""]',
      "dashboard:series:categories:personal": "[]",
    });

    expect(
      readStoredSeriesIds(storage, "dashboard:series:tags:personal"),
    ).toEqual(["tag-trips", ""]);
    expect(
      readStoredSeriesIds(storage, "dashboard:series:categories:personal"),
    ).toEqual([]);
  });

  it("ignores an entry that is not a list of identifiers", () => {
    const storage = memoryStorage({
      broken: "{oops",
      wrongShape: '[{"id":"cat-food"}]',
      notAList: '"cat-food"',
    });

    expect(readStoredSeriesIds(storage, "broken")).toBeNull();
    expect(readStoredSeriesIds(storage, "wrongShape")).toBeNull();
    expect(readStoredSeriesIds(storage, "notAList")).toBeNull();
  });

  it("survives a session storage that refuses to be read", () => {
    const storage: SeriesStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };

    expect(readStoredSeriesIds(storage, "any-key")).toBeNull();
  });
});

describe("readSeriesEntry", () => {
  it("returns the stored text unchanged so a reader can compare it by value", () => {
    const storage = memoryStorage({ key: '["cat-food"]' });

    expect(readSeriesEntry(storage, "key")).toBe('["cat-food"]');
    expect(readSeriesEntry(storage, "key")).toBe(
      readSeriesEntry(storage, "key"),
    );
  });

  it("reports no entry without a storage or when reading is refused", () => {
    expect(readSeriesEntry(null, "key")).toBeNull();
    expect(
      readSeriesEntry(
        {
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => undefined,
        },
        "key",
      ),
    ).toBeNull();
  });
});

describe("writeStoredSeriesIds", () => {
  it("stores the identifiers and nothing else", () => {
    const storage = memoryStorage();

    writeStoredSeriesIds(storage, "key", ["cat-food", UNTAGGED_SERIES_ID]);

    expect(storage.entries.key).toBe('["cat-food","untagged"]');
  });

  it("keeps working when the storage refuses to write", () => {
    const setItem = vi.fn(() => {
      throw new Error("full");
    });

    expect(() => {
      writeStoredSeriesIds({ getItem: () => null, setItem }, "key", ["a"]);
    }).not.toThrow();
    expect(setItem).toHaveBeenCalled();
  });

  it("does nothing at all without a storage", () => {
    expect(() => {
      writeStoredSeriesIds(null, "key", ["a"]);
    }).not.toThrow();
  });
});

describe("defaultSeriesIds", () => {
  it("selects every active option and leaves the archived ones out", () => {
    expect(defaultSeriesIds(options)).toEqual(["cat-food", "cat-home"]);
  });
});

describe("resolveSeriesIds", () => {
  it("follows the catalog while the session has made no decision", () => {
    expect(resolveSeriesIds(options, null)).toEqual(["cat-food", "cat-home"]);
    expect(resolveSeriesIds([...options, { id: "cat-new" }], null)).toEqual([
      "cat-food",
      "cat-home",
      "cat-new",
    ]);
  });

  it("respects a stored decision exactly, new options included or not", () => {
    expect(
      resolveSeriesIds([...options, { id: "cat-new" }], ["cat-food"]),
    ).toEqual(["cat-food"]);
    expect(resolveSeriesIds(options, [])).toEqual([]);
  });
});

describe("selectedSeries", () => {
  it("keeps only the entries the owner is showing, in their own order", () => {
    const entries = [{ id: "a" }, { id: "b" }, { id: "c" }];

    expect(selectedSeries(entries, ["c", "a"])).toEqual([
      { id: "a" },
      { id: "c" },
    ]);
    expect(selectedSeries(entries, [])).toEqual([]);
  });
});
