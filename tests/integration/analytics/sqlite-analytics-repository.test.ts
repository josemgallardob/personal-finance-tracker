/**
 * Analytics aggregations against a real, migrated SQLite file.
 *
 * The dataset is known and deliberately awkward: an expense with two tags, two
 * expenses with none, an archived category and an archived tag that still
 * carry amounts, an interior month without any movement and two months of
 * income. Every case asserts exact minor units against that dataset, proves
 * that a movement with several tags is not counted twice in the general
 * totals, that a page of the history cannot change an aggregate, that another
 * workspace sees nothing and that a snapshot does not observe a writer that
 * commits while it is open. Nothing here stubs the driver.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  RECENT_TRANSACTION_COUNT,
  type AnalyticsResult,
} from "../../../src/modules/analytics/application/ports/analytics-repository";
import { sqliteAnalyticsRepository } from "../../../src/modules/analytics/infrastructure/sqlite-analytics-repository";
import {
  autocommitUnitOfWork,
  runInReadSnapshot,
  type SqliteUnitOfWork,
} from "../../../src/modules/analytics/infrastructure/sqlite-unit-of-work";
import type { DateRange } from "../../../src/modules/analytics/domain/periods";
import type { Category } from "../../../src/modules/classification/domain/category";
import type { Tag } from "../../../src/modules/classification/domain/tag";
import { parseListTransactionsInput } from "../../../src/modules/transactions/application/list-transaction-filters";
import { sqliteTransactionQuery } from "../../../src/modules/transactions/infrastructure/sqlite-list-transactions-query";
import { autocommitUnitOfWork as transactionUnit } from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";
import type { LocalDate, MonthKey } from "../../../src/shared/domain/dates";
import { MAX_TRANSACTION_MINOR } from "../../../src/shared/domain/money";
import { loadAppConfig } from "../../../src/shared/server/config";
import { openSqliteConnection } from "../../../src/shared/server/database";
import { createValidAppEnv } from "../helpers/sqlite";
import {
  type AnalyticsFixture,
  archiveCategory,
  archiveTag,
  createAnalyticsFixture,
  errorCode,
  okValue,
  storeCategory,
  storeTag,
  storeTransaction,
} from "./helpers";

/** Interval that contains every movement of the known dataset. */
const WHOLE_RANGE: DateRange = {
  start: "2026-01-01" as LocalDate,
  end: "2026-05-31" as LocalDate,
};

const JANUARY = "2026-01" as MonthKey;
const FEBRUARY = "2026-02" as MonthKey;
const MARCH = "2026-03" as MonthKey;
const APRIL = "2026-04" as MonthKey;
const MAY = "2026-05" as MonthKey;

let fixture: AnalyticsFixture;
let workspaceId: string;
let home: Category;
let leisure: Category;
let gym: Category;
let salary: Category;
let travel: Tag;
let withFriends: Tag;
let retired: Tag;

/**
 * Known dataset, in exact minor units.
 *
 * | Date       | Type    | Category | Amount | Tags                 |
 * | ---------- | ------- | -------- | ------ | -------------------- |
 * | 2026-01-15 | expense | home     | 10 000 | none                 |
 * | 2026-01-20 | expense | leisure  |  6 000 | travel, withFriends  |
 * | 2026-02-10 | expense | gym      | 12 000 | retired              |
 * | 2026-02-28 | income  | salary   | 200000 | none                 |
 * | 2026-03-05 | expense | leisure  |  2 500 | travel               |
 * | 2026-03-31 | income  | salary   | 50 000 | none                 |
 * | 2026-05-02 | expense | home     |      1 | none                 |
 *
 * The gym category and the retired tag are archived after their movement, so
 * their 12 000 stay inside the totals while the interface may hide their bar.
 * April is left empty on purpose: it is an interior month of the series.
 */
function seedKnownDataset(): void {
  home = storeCategory(fixture, "Casa", "expense", 0);
  leisure = storeCategory(fixture, "Ocio", "expense", 1);
  gym = storeCategory(fixture, "Gimnasio", "expense", 2);
  salary = storeCategory(fixture, "Nómina", "income", 0);
  travel = storeTag(fixture, "viajes");
  withFriends = storeTag(fixture, "con amigos");
  retired = storeTag(fixture, "temporada");

  storeTransaction(fixture, {
    category: home,
    amountMinor: 10_000,
    date: "2026-01-15",
    createdAt: 1_800_000_001_000,
    updatedAt: 1_800_000_001_000,
  });
  storeTransaction(fixture, {
    category: leisure,
    amountMinor: 6_000,
    date: "2026-01-20",
    tagIds: [travel.id, withFriends.id],
    createdAt: 1_800_000_002_000,
    updatedAt: 1_800_000_002_000,
  });
  storeTransaction(fixture, {
    category: gym,
    amountMinor: 12_000,
    date: "2026-02-10",
    tagIds: [retired.id],
    createdAt: 1_800_000_003_000,
    updatedAt: 1_800_000_003_000,
  });
  storeTransaction(fixture, {
    category: salary,
    amountMinor: 200_000,
    date: "2026-02-28",
    createdAt: 1_800_000_004_000,
    updatedAt: 1_800_000_004_000,
  });
  storeTransaction(fixture, {
    category: leisure,
    amountMinor: 2_500,
    date: "2026-03-05",
    tagIds: [travel.id],
    createdAt: 1_800_000_005_000,
    updatedAt: 1_800_000_005_000,
  });
  storeTransaction(fixture, {
    category: salary,
    amountMinor: 50_000,
    date: "2026-03-31",
    createdAt: 1_800_000_006_000,
    updatedAt: 1_800_000_006_000,
  });
  storeTransaction(fixture, {
    category: home,
    amountMinor: 1,
    date: "2026-05-02",
    createdAt: 1_800_000_007_000,
    updatedAt: 1_800_000_007_000,
  });

  gym = archiveCategory(fixture, gym);
  retired = archiveTag(fixture, retired);
}

function unit(): SqliteUnitOfWork {
  return autocommitUnitOfWork(fixture.connection);
}

beforeEach(() => {
  fixture = createAnalyticsFixture();
  workspaceId = fixture.workspaceId;
  seedKnownDataset();
});

afterEach(() => {
  fixture.cleanup();
});

describe("type totals", () => {
  it("sums both types of the interval without multiplying a tagged movement", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.readTypeTotals(unit(), {
          workspaceId,
          range: WHOLE_RANGE,
        }),
      ),
    ).toEqual({
      incomeMinor: 250_000,
      expenseMinor: 30_501,
      incomeCount: 2,
      expenseCount: 5,
    });
  });

  it("counts only the movements inside the inclusive interval", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.readTypeTotals(unit(), {
          workspaceId,
          range: {
            start: "2026-01-20" as LocalDate,
            end: "2026-02-28" as LocalDate,
          },
        }),
      ),
    ).toEqual({
      incomeMinor: 200_000,
      expenseMinor: 18_000,
      incomeCount: 1,
      expenseCount: 2,
    });
  });

  it("reports zeros for an interval without movements", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.readTypeTotals(unit(), {
          workspaceId,
          range: {
            start: "2026-04-01" as LocalDate,
            end: "2026-04-30" as LocalDate,
          },
        }),
      ),
    ).toEqual({
      incomeMinor: 0,
      expenseMinor: 0,
      incomeCount: 0,
      expenseCount: 0,
    });
  });

  it("sees nothing of another workspace", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.readTypeTotals(unit(), {
          workspaceId: "missing-workspace",
          range: WHOLE_RANGE,
        }),
      ),
    ).toEqual({
      incomeMinor: 0,
      expenseMinor: 0,
      incomeCount: 0,
      expenseCount: 0,
    });
  });
});

describe("monthly totals", () => {
  it("materializes every requested month, including the empty one", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.readMonthlyTotals(unit(), {
          workspaceId,
          months: [JANUARY, FEBRUARY, MARCH, APRIL, MAY],
        }),
      ),
    ).toEqual([
      {
        month: JANUARY,
        incomeMinor: 0,
        expenseMinor: 16_000,
        incomeCount: 0,
        expenseCount: 2,
      },
      {
        month: FEBRUARY,
        incomeMinor: 200_000,
        expenseMinor: 12_000,
        incomeCount: 1,
        expenseCount: 1,
      },
      {
        month: MARCH,
        incomeMinor: 50_000,
        expenseMinor: 2_500,
        incomeCount: 1,
        expenseCount: 1,
      },
      {
        month: APRIL,
        incomeMinor: 0,
        expenseMinor: 0,
        incomeCount: 0,
        expenseCount: 0,
      },
      {
        month: MAY,
        incomeMinor: 0,
        expenseMinor: 1,
        incomeCount: 0,
        expenseCount: 1,
      },
    ]);
  });

  it("keeps the requested order and ignores months outside the window", () => {
    const totals = okValue(
      sqliteAnalyticsRepository.readMonthlyTotals(unit(), {
        workspaceId,
        months: [MARCH, FEBRUARY],
      }),
    );

    expect(totals.map((entry) => entry.month)).toEqual([MARCH, FEBRUARY]);
    expect(totals.map((entry) => entry.expenseMinor)).toEqual([2_500, 12_000]);
  });

  it("reads no month when none is requested", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.readMonthlyTotals(unit(), {
          workspaceId,
          months: [],
        }),
      ),
    ).toEqual([]);
  });

  it("sees nothing of another workspace", () => {
    const totals = okValue(
      sqliteAnalyticsRepository.readMonthlyTotals(unit(), {
        workspaceId: "missing-workspace",
        months: [JANUARY, FEBRUARY],
      }),
    );

    expect(totals.map((entry) => entry.expenseMinor)).toEqual([0, 0]);
  });
});

describe("expense by category", () => {
  it("orders by amount and keeps the archived category with its amount", () => {
    const totals = okValue(
      sqliteAnalyticsRepository.readExpenseByCategory(unit(), {
        workspaceId,
        range: WHOLE_RANGE,
      }),
    );

    expect(
      totals.map((entry) => [
        entry.category.name,
        entry.totalMinor,
        entry.transactionCount,
        entry.category.archivedAt !== null,
      ]),
    ).toEqual([
      ["Gimnasio", 12_000, 1, true],
      ["Casa", 10_001, 2, false],
      ["Ocio", 8_500, 2, false],
    ]);
  });

  it("adds up to the expense of the general totals", () => {
    const totals = okValue(
      sqliteAnalyticsRepository.readExpenseByCategory(unit(), {
        workspaceId,
        range: WHOLE_RANGE,
      }),
    );

    expect(totals.reduce((sum, entry) => sum + entry.totalMinor, 0)).toBe(
      30_501,
    );
  });

  it("leaves out the income categories", () => {
    const totals = okValue(
      sqliteAnalyticsRepository.readExpenseByCategory(unit(), {
        workspaceId,
        range: WHOLE_RANGE,
      }),
    );

    expect(totals.map((entry) => entry.category.id)).not.toContain(salary.id);
  });

  it("reports an empty breakdown for an interval without expense", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.readExpenseByCategory(unit(), {
          workspaceId,
          range: {
            start: "2026-03-31" as LocalDate,
            end: "2026-04-30" as LocalDate,
          },
        }),
      ),
    ).toEqual([]);
  });

  it("sees nothing of another workspace", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.readExpenseByCategory(unit(), {
          workspaceId: "missing-workspace",
          range: WHOLE_RANGE,
        }),
      ),
    ).toEqual([]);
  });

  it("refuses a stored category that no longer satisfies its contract", () => {
    fixture.connection.sqlite
      .prepare("update category set name = '' where id = ?")
      .run(home.id);

    expect(
      errorCode(
        sqliteAnalyticsRepository.readExpenseByCategory(unit(), {
          workspaceId,
          range: WHOLE_RANGE,
        }),
      ),
    ).toBe("invalidStoredRow");
  });
});

describe("expense by tag", () => {
  it("attributes the whole amount to each tag of a movement", () => {
    const breakdown = okValue(
      sqliteAnalyticsRepository.readExpenseByTag(unit(), {
        workspaceId,
        range: WHOLE_RANGE,
      }),
    );

    expect(
      breakdown.tags.map((entry) => [
        entry.tag.name,
        entry.totalMinor,
        entry.transactionCount,
        entry.tag.archivedAt !== null,
      ]),
    ).toEqual([
      ["temporada", 12_000, 1, true],
      ["viajes", 8_500, 2, false],
      ["con amigos", 6_000, 1, false],
    ]);
  });

  it("reports overlapping groups whose sum exceeds the total expense", () => {
    const breakdown = okValue(
      sqliteAnalyticsRepository.readExpenseByTag(unit(), {
        workspaceId,
        range: WHOLE_RANGE,
      }),
    );
    const tagged = breakdown.tags.reduce(
      (sum, entry) => sum + entry.totalMinor,
      0,
    );

    expect(tagged).toBe(26_500);
    expect(tagged + breakdown.untaggedMinor).toBeGreaterThan(30_501);
  });

  it("computes the untagged expense as a disjoint group", () => {
    const breakdown = okValue(
      sqliteAnalyticsRepository.readExpenseByTag(unit(), {
        workspaceId,
        range: WHOLE_RANGE,
      }),
    );

    expect(breakdown.untaggedMinor).toBe(10_001);
    expect(breakdown.untaggedCount).toBe(2);
  });

  it("reports no untagged expense when every expense carries a tag", () => {
    const breakdown = okValue(
      sqliteAnalyticsRepository.readExpenseByTag(unit(), {
        workspaceId,
        range: {
          start: "2026-01-20" as LocalDate,
          end: "2026-02-10" as LocalDate,
        },
      }),
    );

    expect(breakdown.untaggedMinor).toBe(0);
    expect(breakdown.untaggedCount).toBe(0);
    expect(breakdown.tags).toHaveLength(3);
  });

  it("sees nothing of another workspace", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.readExpenseByTag(unit(), {
          workspaceId: "missing-workspace",
          range: WHOLE_RANGE,
        }),
      ),
    ).toEqual({ tags: [], untaggedMinor: 0, untaggedCount: 0 });
  });

  it("refuses a stored tag that no longer satisfies its contract", () => {
    fixture.connection.sqlite
      .prepare("update tag set name = '' where id = ?")
      .run(travel.id);

    expect(
      errorCode(
        sqliteAnalyticsRepository.readExpenseByTag(unit(), {
          workspaceId,
          range: WHOLE_RANGE,
        }),
      ),
    ).toBe("invalidStoredRow");
  });
});

describe("first transaction date", () => {
  it("reads the earliest civil date of the whole history", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.findFirstTransactionDate(unit(), {
          workspaceId,
        }),
      ),
    ).toBe("2026-01-15");
  });

  it("reports no date for a workspace without movements", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.findFirstTransactionDate(unit(), {
          workspaceId: "missing-workspace",
        }),
      ),
    ).toBeNull();
  });

  it("refuses a stored date that is not a real calendar day", () => {
    fixture.connection.sqlite
      .prepare("update \"transaction\" set date = '0000-01-01' where id = ?")
      .run(
        fixture.connection.sqlite
          .prepare('select id from "transaction" limit 1')
          .pluck()
          .get(),
      );

    expect(
      errorCode(
        sqliteAnalyticsRepository.findFirstTransactionDate(unit(), {
          workspaceId,
        }),
      ),
    ).toBe("invalidStoredRow");
  });
});

describe("recent transactions", () => {
  it("reads the five most recent movements with their tags", () => {
    const recent = okValue(
      sqliteAnalyticsRepository.readRecentTransactions(unit(), {
        workspaceId,
        limit: RECENT_TRANSACTION_COUNT,
      }),
    );

    expect(recent.map((movement) => movement.date)).toEqual([
      "2026-05-02",
      "2026-03-31",
      "2026-03-05",
      "2026-02-28",
      "2026-02-10",
    ]);
    expect(recent[2].tagIds).toEqual([travel.id]);
  });

  it("reads nothing when the limit is not positive", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.readRecentTransactions(unit(), {
          workspaceId,
          limit: 0,
        }),
      ),
    ).toEqual([]);
  });

  it("sees nothing of another workspace", () => {
    expect(
      okValue(
        sqliteAnalyticsRepository.readRecentTransactions(unit(), {
          workspaceId: "missing-workspace",
          limit: RECENT_TRANSACTION_COUNT,
        }),
      ),
    ).toEqual([]);
  });

  it("refuses a stored movement that no longer satisfies its contract", () => {
    fixture.connection.sqlite
      .prepare("update category set name = '' where id = ?")
      .run(home.id);

    expect(
      errorCode(
        sqliteAnalyticsRepository.readRecentTransactions(unit(), {
          workspaceId,
          limit: RECENT_TRANSACTION_COUNT,
        }),
      ),
    ).toBe("invalidStoredRow");
  });
});

describe("independence from the history pagination", () => {
  it("keeps every aggregate while the history walks its pages", () => {
    const before = okValue(
      sqliteAnalyticsRepository.readTypeTotals(unit(), {
        workspaceId,
        range: WHOLE_RANGE,
      }),
    );
    const parsed = parseListTransactionsInput({ workspaceId, limit: 2 });

    if (!parsed.ok) {
      throw new Error(`Expected valid filters: ${JSON.stringify(parsed)}`);
    }

    const page = sqliteTransactionQuery.listTransactions(
      transactionUnit(fixture.connection),
      parsed.value,
    );

    if (!page.ok) {
      throw new Error(`Expected a page: ${JSON.stringify(page)}`);
    }

    expect(page.value.items).toHaveLength(2);
    expect(page.value.hasNextPage).toBe(true);
    expect(
      okValue(
        sqliteAnalyticsRepository.readTypeTotals(unit(), {
          workspaceId,
          range: WHOLE_RANGE,
        }),
      ),
    ).toEqual(before);
    expect(before.expenseMinor).toBe(30_501);
  });
});

describe("read snapshot", () => {
  it("does not observe a movement another connection commits while it is open", () => {
    const config = loadAppConfig(
      createValidAppEnv(fixture.connection.filePath),
    );

    if (!config.ok) {
      throw new Error(
        `Expected valid configuration: ${JSON.stringify(config)}`,
      );
    }

    const writer = openSqliteConnection(config.value);

    if (!writer.ok) {
      throw new Error(
        `Expected a second connection: ${JSON.stringify(writer)}`,
      );
    }

    try {
      const observed = runInReadSnapshot(fixture.connection, (snapshot) => {
        const first = sqliteAnalyticsRepository.readTypeTotals(snapshot, {
          workspaceId,
          range: WHOLE_RANGE,
        });

        writer.value.sqlite
          .prepare(
            'insert into "transaction" (id, workspace_id, type, amount_minor, date, category_id, concept, note, created_at, updated_at) values (?, ?, ?, ?, ?, ?, null, null, ?, ?)',
          )
          .run(
            "written-mid-snapshot",
            workspaceId,
            "expense",
            999,
            "2026-03-20",
            home.id,
            1_800_000_009_000,
            1_800_000_009_000,
          );

        const second = sqliteAnalyticsRepository.readTypeTotals(snapshot, {
          workspaceId,
          range: WHOLE_RANGE,
        });
        const monthly = sqliteAnalyticsRepository.readMonthlyTotals(snapshot, {
          workspaceId,
          months: [MARCH],
        });

        if (!first.ok || !second.ok || !monthly.ok) {
          throw new Error("Expected three accepted reads");
        }

        return {
          ok: true,
          value: {
            first: first.value,
            second: second.value,
            march: monthly.value[0].expenseMinor,
          },
        } satisfies AnalyticsResult<{
          first: unknown;
          second: unknown;
          march: number;
        }>;
      });

      const snapshot = okValue(observed);

      expect(snapshot.second).toEqual(snapshot.first);
      expect(snapshot.march).toBe(2_500);
      expect(
        okValue(
          sqliteAnalyticsRepository.readTypeTotals(unit(), {
            workspaceId,
            range: WHOLE_RANGE,
          }),
        ).expenseMinor,
      ).toBe(31_500);
    } finally {
      writer.value.close();
    }
  });

  it("reports a storage failure when the snapshot cannot be opened", () => {
    const closed = createAnalyticsFixture();

    closed.connection.close();

    expect(
      errorCode(
        sqliteAnalyticsRepository.readTypeTotals(
          autocommitUnitOfWork(closed.connection),
          { workspaceId: closed.workspaceId, range: WHOLE_RANGE },
        ),
      ),
    ).toBe("storageFailure");

    closed.cleanup();
  });

  it("reports a storage failure for every read of a closed connection", () => {
    const closed = createAnalyticsFixture();

    closed.connection.close();

    const dead: SqliteUnitOfWork = {
      isTransactional: true,
      db: closed.connection.db,
    };
    const scope = { workspaceId: closed.workspaceId };
    const reads: AnalyticsResult<unknown>[] = [
      sqliteAnalyticsRepository.readTypeTotals(dead, {
        ...scope,
        range: WHOLE_RANGE,
      }),
      sqliteAnalyticsRepository.readMonthlyTotals(dead, {
        ...scope,
        months: [MARCH],
      }),
      sqliteAnalyticsRepository.readExpenseByCategory(dead, {
        ...scope,
        range: WHOLE_RANGE,
      }),
      sqliteAnalyticsRepository.readExpenseByTag(dead, {
        ...scope,
        range: WHOLE_RANGE,
      }),
      sqliteAnalyticsRepository.findFirstTransactionDate(dead, scope),
      sqliteAnalyticsRepository.readRecentTransactions(dead, {
        ...scope,
        limit: RECENT_TRANSACTION_COUNT,
      }),
    ];

    expect(reads.map((read) => errorCode(read))).toEqual([
      "storageFailure",
      "storageFailure",
      "storageFailure",
      "storageFailure",
      "storageFailure",
      "storageFailure",
    ]);

    closed.cleanup();
  });
});

describe("dense workspace", () => {
  let dense: AnalyticsFixture;
  let denseRows: number;

  /**
   * Fills a workspace until its expense no longer fits an exact integer.
   *
   * Every movement carries the largest amount the schema accepts, so the sum
   * crosses the safe integer range while each row stays valid. The rows are
   * written with the real driver and are all associated with one tag, which
   * makes every aggregation of the module cross the same boundary.
   */
  function fillUntilOverflow(target: AnalyticsFixture, tagId: string): number {
    const rows = Math.ceil(Number.MAX_SAFE_INTEGER / MAX_TRANSACTION_MINOR);
    const category = storeCategory(target, "Desbordamiento", "expense", 0);
    const sqlite = target.connection.sqlite;
    const insertMovement = sqlite.prepare(
      'insert into "transaction" (id, workspace_id, type, amount_minor, date, category_id, concept, note, created_at, updated_at) values (?, ?, ?, ?, ?, ?, null, null, ?, ?)',
    );
    const insertAssociation = sqlite.prepare(
      "insert into transaction_tag (transaction_id, tag_id, workspace_id) values (?, ?, ?)",
    );

    sqlite.transaction(() => {
      for (let index = 0; index < rows; index += 1) {
        const id = `overflow-${index}`;

        insertMovement.run(
          id,
          target.workspaceId,
          "expense",
          MAX_TRANSACTION_MINOR,
          "2026-06-15",
          category.id,
          1_800_000_100_000 + index,
          1_800_000_100_000 + index,
        );
        insertAssociation.run(id, tagId, target.workspaceId);
      }
    })();

    return rows;
  }

  beforeAll(() => {
    dense = createAnalyticsFixture();
    denseRows = fillUntilOverflow(dense, storeTag(dense, "desbordado").id);
  });

  afterAll(() => {
    dense.cleanup();
  });

  it("refuses every aggregation whose exact sum stops being representable", () => {
    const unitOfWork = autocommitUnitOfWork(dense.connection);
    const scope = { workspaceId: dense.workspaceId };
    const range: DateRange = {
      start: "2026-06-01" as LocalDate,
      end: "2026-06-30" as LocalDate,
    };

    expect(denseRows * MAX_TRANSACTION_MINOR).toBeGreaterThan(
      Number.MAX_SAFE_INTEGER,
    );
    expect(
      [
        sqliteAnalyticsRepository.readTypeTotals(unitOfWork, {
          ...scope,
          range,
        }),
        sqliteAnalyticsRepository.readMonthlyTotals(unitOfWork, {
          ...scope,
          months: ["2026-06" as MonthKey],
        }),
        sqliteAnalyticsRepository.readExpenseByCategory(unitOfWork, {
          ...scope,
          range,
        }),
        sqliteAnalyticsRepository.readExpenseByTag(unitOfWork, {
          ...scope,
          range,
        }),
      ].map((read) => errorCode(read)),
    ).toEqual([
      "amountOverflow",
      "amountOverflow",
      "amountOverflow",
      "amountOverflow",
    ]);
  });

  it("still reads the five most recent movements of a dense workspace", () => {
    const recent = okValue(
      sqliteAnalyticsRepository.readRecentTransactions(
        autocommitUnitOfWork(dense.connection),
        { workspaceId: dense.workspaceId, limit: RECENT_TRANSACTION_COUNT },
      ),
    );

    expect(recent).toHaveLength(RECENT_TRANSACTION_COUNT);
    expect(recent.every((movement) => movement.date === "2026-06-15")).toBe(
      true,
    );
  });

  /**
   * A limit far above the number of values SQLite can bind at once cannot be
   * rebuilt in a single statement. The read reports a controlled storage
   * failure instead of letting the driver error escape the port.
   */
  it("reports a storage failure for a limit the driver cannot bind", () => {
    expect(
      errorCode(
        sqliteAnalyticsRepository.readRecentTransactions(
          autocommitUnitOfWork(dense.connection),
          { workspaceId: dense.workspaceId, limit: denseRows },
        ),
      ),
    ).toBe("storageFailure");
  });
});

describe("controlled failures", () => {
  it("reports a storage failure when the snapshot cannot be opened at all", () => {
    const closed = createAnalyticsFixture();

    closed.connection.close();

    expect(
      errorCode(
        runInReadSnapshot(closed.connection, (snapshot) =>
          sqliteAnalyticsRepository.findFirstTransactionDate(snapshot, {
            workspaceId: closed.workspaceId,
          }),
        ),
      ),
    ).toBe("storageFailure");

    closed.cleanup();
  });

  it("describes a snapshot that throws a value which is not an error", () => {
    const failure = runInReadSnapshot(fixture.connection, () => {
      throw "unexpected";
    });

    expect(failure).toEqual({
      ok: false,
      error: { code: "storageFailure", cause: "unexpected" },
    });
  });
});
