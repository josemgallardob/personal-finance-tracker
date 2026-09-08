/**
 * SQLite adapter of the analytics read port.
 *
 * Every figure is aggregated by the database over the whole dataset of the
 * workspace, so no total depends on how many pages of history a client has
 * loaded. Sums stay integer inside SQLite and are checked before they leave
 * this module: a sum that no longer fits an exact integer is refused instead
 * of being rounded into a plausible but wrong amount.
 *
 * The aggregation by type never touches `transaction_tag`. Joining the
 * associations there would count a movement once per tag and inflate income
 * and expense, so the tag breakdown is a separate statement whose groups are
 * allowed to overlap. Expense with no tag at all is a computed group, resolved
 * with `NOT EXISTS` instead of an artificial tag row.
 *
 * A read that receives a unit which is not transactional opens a read snapshot
 * of its own, so its statements cannot straddle a writer that commits in
 * between; a caller that needs several reads to agree opens one snapshot and
 * passes the same unit to all of them.
 */

import "server-only";

import { and, asc, desc, eq, gte, lte, notExists, sql } from "drizzle-orm";

import {
  category,
  tag,
  transaction,
  transactionTag,
} from "../../../../db/schema";
import {
  type Category,
  createCategory,
} from "../../classification/domain/category";
import { type Tag, createTag } from "../../classification/domain/tag";
import { sqliteTransactionRepository } from "../../transactions/infrastructure/sqlite-transaction-repository";
import type {
  TransactionRepositoryError,
  TransactionResult,
} from "../../transactions/application/ports/transaction-repository";
import type {
  Transaction,
  TransactionId,
} from "../../transactions/domain/transaction";
import { type LocalDate, parseLocalDate } from "../../../shared/domain/dates";
import { type MoneyMinor, isMoneyMinor } from "../../../shared/domain/money";
import {
  type AnalyticsRepository,
  type AnalyticsResult,
  type CategoryExpenseTotal,
  type DateRangeQuery,
  type MonthlyTotals,
  type MonthlyTotalsQuery,
  type RecentTransactionsQuery,
  type TagExpenseBreakdown,
  type TagExpenseTotal,
  type TypeTotals,
  type WorkspaceScope,
  failed,
  succeeded,
} from "../application/ports/analytics-repository";
import { describeCause } from "./sqlite-errors";
import type { SqliteUnitOfWork } from "./sqlite-unit-of-work";

/** Type whose movements the two breakdowns of the dashboard aggregate. */
const EXPENSE = "expense";

/** Type of the movements the dashboard reports as income. */
const INCOME = "income";

/** Day text that sorts after every real day of a month. */
const LAST_DAY_OF_MONTH = "-31";

/** First day of a month, as the lower bound of a month window. */
const FIRST_DAY_OF_MONTH = "-01";

const monthExpression = sql<string>`substr(${transaction.date}, 1, 7)`;
const summedAmount = sql<number>`sum(${transaction.amountMinor})`;
const countedRows = sql<number>`count(*)`;

/** Totals of a type inside a group of movements. */
interface TypedTotalRow {
  readonly type: string;
  readonly totalMinor: number;
  readonly transactionCount: number;
}

/**
 * Tells whether every sum can still be represented exactly.
 *
 * SQLite adds minor units as 64-bit integers, but a number that leaves the
 * driver above the safe integer range is already an approximation. The read
 * refuses the aggregation instead of reporting an amount nobody can reconcile
 * with the history.
 */
function areExactAmounts(values: readonly number[]): boolean {
  return values.every((value) => isMoneyMinor(value));
}

/**
 * Narrows a sum already validated by {@link areExactAmounts}.
 *
 * The check runs once per statement over every sum it produced, so the values
 * that reach this point are exact by construction.
 */
function exact(value: number): MoneyMinor {
  return value as MoneyMinor;
}

/** Runs `read` inside the caller snapshot, or inside one opened for it. */
function inSnapshot<TValue>(
  unit: SqliteUnitOfWork,
  read: (unit: SqliteUnitOfWork) => AnalyticsResult<TValue>,
): AnalyticsResult<TValue> {
  if (unit.isTransactional) {
    return read(unit);
  }

  try {
    return unit.db.transaction((tx) => read({ isTransactional: true, db: tx }));
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }
}

/** Movements of the workspace inside an inclusive interval of civil dates. */
function rangeConditions(query: DateRangeQuery) {
  return and(
    eq(transaction.workspaceId, query.workspaceId),
    gte(transaction.date, query.range.start),
    lte(transaction.date, query.range.end),
  );
}

function foldTypeTotals(rows: readonly TypedTotalRow[]): TypeTotals {
  let incomeMinor = 0;
  let expenseMinor = 0;
  let incomeCount = 0;
  let expenseCount = 0;

  for (const row of rows) {
    if (row.type === INCOME) {
      incomeMinor = row.totalMinor;
      incomeCount = row.transactionCount;
    } else {
      expenseMinor = row.totalMinor;
      expenseCount = row.transactionCount;
    }
  }

  return {
    incomeMinor: exact(incomeMinor),
    expenseMinor: exact(expenseMinor),
    incomeCount,
    expenseCount,
  };
}

function readTypeTotals(
  unit: SqliteUnitOfWork,
  query: DateRangeQuery,
): AnalyticsResult<TypeTotals> {
  return inSnapshot(unit, (snapshot) => {
    let rows: TypedTotalRow[];

    try {
      rows = snapshot.db
        .select({
          type: transaction.type,
          totalMinor: summedAmount,
          transactionCount: countedRows,
        })
        .from(transaction)
        .where(rangeConditions(query))
        .groupBy(transaction.type)
        .all();
    } catch (cause) {
      return failed("storageFailure", describeCause(cause));
    }

    if (!areExactAmounts(rows.map((row) => row.totalMinor))) {
      return failed("amountOverflow");
    }

    return succeeded(foldTypeTotals(rows));
  });
}

function readMonthlyTotals(
  unit: SqliteUnitOfWork,
  query: MonthlyTotalsQuery,
): AnalyticsResult<readonly MonthlyTotals[]> {
  if (query.months.length === 0) {
    return succeeded([]);
  }

  const sorted = [...query.months].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  return inSnapshot(unit, (snapshot) => {
    let rows: (TypedTotalRow & { readonly month: string })[];

    try {
      rows = snapshot.db
        .select({
          month: monthExpression,
          type: transaction.type,
          totalMinor: summedAmount,
          transactionCount: countedRows,
        })
        .from(transaction)
        .where(
          and(
            eq(transaction.workspaceId, query.workspaceId),
            gte(transaction.date, `${first}${FIRST_DAY_OF_MONTH}`),
            lte(transaction.date, `${last}${LAST_DAY_OF_MONTH}`),
          ),
        )
        .groupBy(monthExpression, transaction.type)
        .all();
    } catch (cause) {
      return failed("storageFailure", describeCause(cause));
    }

    if (!areExactAmounts(rows.map((row) => row.totalMinor))) {
      return failed("amountOverflow");
    }

    const grouped = new Map<string, TypedTotalRow[]>();

    for (const row of rows) {
      const monthRows = grouped.get(row.month) ?? [];

      monthRows.push(row);
      grouped.set(row.month, monthRows);
    }

    return succeeded(
      query.months.map((month) => ({
        month,
        ...foldTypeTotals(grouped.get(month) ?? []),
      })),
    );
  });
}

function readExpenseByCategory(
  unit: SqliteUnitOfWork,
  query: DateRangeQuery,
): AnalyticsResult<readonly CategoryExpenseTotal[]> {
  return inSnapshot(unit, (snapshot) => {
    let rows: {
      readonly id: string;
      readonly name: string;
      readonly type: string;
      readonly sortOrder: number;
      readonly archivedAt: number | null;
      readonly totalMinor: number;
      readonly transactionCount: number;
    }[];

    try {
      rows = snapshot.db
        .select({
          id: category.id,
          name: category.name,
          type: category.type,
          sortOrder: category.sortOrder,
          archivedAt: category.archivedAt,
          totalMinor: summedAmount,
          transactionCount: countedRows,
        })
        .from(transaction)
        .innerJoin(
          category,
          and(
            eq(category.id, transaction.categoryId),
            eq(category.workspaceId, transaction.workspaceId),
          ),
        )
        .where(and(rangeConditions(query), eq(transaction.type, EXPENSE)))
        .groupBy(category.id)
        .orderBy(desc(summedAmount), asc(category.name), asc(category.id))
        .all();
    } catch (cause) {
      return failed("storageFailure", describeCause(cause));
    }

    if (!areExactAmounts(rows.map((row) => row.totalMinor))) {
      return failed("amountOverflow");
    }

    const totals: CategoryExpenseTotal[] = [];

    for (const row of rows) {
      const built = createCategory(row);

      if (!built.ok) {
        return invalidStoredRow<readonly CategoryExpenseTotal[]>(
          "category",
          built.errors,
        );
      }

      totals.push({
        category: built.value satisfies Category,
        totalMinor: exact(row.totalMinor),
        transactionCount: row.transactionCount,
      });
    }

    return succeeded(totals);
  });
}

function readExpenseByTag(
  unit: SqliteUnitOfWork,
  query: DateRangeQuery,
): AnalyticsResult<TagExpenseBreakdown> {
  return inSnapshot(unit, (snapshot) => {
    let rows: {
      readonly id: string;
      readonly name: string;
      readonly archivedAt: number | null;
      readonly totalMinor: number;
      readonly transactionCount: number;
    }[];
    let untagged: {
      readonly totalMinor: number;
      readonly transactionCount: number;
    }[];

    try {
      rows = snapshot.db
        .select({
          id: tag.id,
          name: tag.name,
          archivedAt: tag.archivedAt,
          totalMinor: summedAmount,
          transactionCount: countedRows,
        })
        .from(transactionTag)
        .innerJoin(
          transaction,
          and(
            eq(transaction.id, transactionTag.transactionId),
            eq(transaction.workspaceId, transactionTag.workspaceId),
          ),
        )
        .innerJoin(
          tag,
          and(
            eq(tag.id, transactionTag.tagId),
            eq(tag.workspaceId, transactionTag.workspaceId),
          ),
        )
        .where(and(rangeConditions(query), eq(transaction.type, EXPENSE)))
        .groupBy(tag.id)
        .orderBy(desc(summedAmount), asc(tag.name), asc(tag.id))
        .all();

      untagged = snapshot.db
        .select({
          totalMinor: sql<number>`coalesce(${summedAmount}, 0)`,
          transactionCount: countedRows,
        })
        .from(transaction)
        .where(
          and(
            rangeConditions(query),
            eq(transaction.type, EXPENSE),
            notExists(
              snapshot.db
                .select({ one: sql`1` })
                .from(transactionTag)
                .where(
                  and(
                    eq(transactionTag.transactionId, transaction.id),
                    eq(transactionTag.workspaceId, transaction.workspaceId),
                  ),
                ),
            ),
          ),
        )
        .all();
    } catch (cause) {
      return failed("storageFailure", describeCause(cause));
    }

    const untaggedTotals = untagged[0];
    const sums = rows.map((row) => row.totalMinor);

    sums.push(untaggedTotals.totalMinor);

    if (!areExactAmounts(sums)) {
      return failed("amountOverflow");
    }

    const tags: TagExpenseTotal[] = [];

    for (const row of rows) {
      const built = createTag(row);

      if (!built.ok) {
        return invalidStoredRow<TagExpenseBreakdown>("tag", built.errors);
      }

      tags.push({
        tag: built.value satisfies Tag,
        totalMinor: exact(row.totalMinor),
        transactionCount: row.transactionCount,
      });
    }

    return succeeded({
      tags,
      untaggedMinor: exact(untaggedTotals.totalMinor),
      untaggedCount: untaggedTotals.transactionCount,
    });
  });
}

function findFirstTransactionDate(
  unit: SqliteUnitOfWork,
  scope: WorkspaceScope,
): AnalyticsResult<LocalDate | null> {
  return inSnapshot(unit, (snapshot) => {
    let rows: { readonly date: string | null }[];

    try {
      rows = snapshot.db
        .select({ date: sql<string | null>`min(${transaction.date})` })
        .from(transaction)
        .where(eq(transaction.workspaceId, scope.workspaceId))
        .all();
    } catch (cause) {
      return failed("storageFailure", describeCause(cause));
    }

    const earliest = rows[0].date;

    if (earliest === null) {
      return succeeded(null);
    }

    const parsed = parseLocalDate(earliest);

    if (!parsed.ok) {
      return failed<LocalDate | null>(
        "invalidStoredRow",
        `date:${parsed.error}`,
      );
    }

    return succeeded(parsed.value);
  });
}

function readRecentTransactions(
  unit: SqliteUnitOfWork,
  query: RecentTransactionsQuery,
): AnalyticsResult<readonly Transaction[]> {
  if (query.limit <= 0) {
    return succeeded([]);
  }

  return inSnapshot(unit, (snapshot) => {
    let rows: { readonly id: string }[];

    try {
      rows = snapshot.db
        .select({ id: transaction.id })
        .from(transaction)
        .where(eq(transaction.workspaceId, query.workspaceId))
        .orderBy(
          desc(transaction.date),
          desc(transaction.createdAt),
          desc(transaction.id),
        )
        .limit(query.limit)
        .all();
    } catch (cause) {
      return failed("storageFailure", describeCause(cause));
    }

    return fromTransactionResult(
      sqliteTransactionRepository.findTransactionsByIds(snapshot, {
        workspaceId: query.workspaceId,
        transactionIds: rows.map((row) => row.id as TransactionId),
      }),
    );
  });
}

/** Refusal of a stored row that no longer satisfies its domain contract. */
function invalidStoredRow<TValue>(
  prefix: string,
  errors: readonly { readonly field: string; readonly code: string }[],
): AnalyticsResult<TValue> {
  return failed(
    "invalidStoredRow",
    errors.map((error) => `${prefix}.${error.field}:${error.code}`).join(","),
  );
}

/**
 * Reports a refusal of the transaction adapter in the vocabulary of this port.
 *
 * The recent movements are rebuilt by the module that owns them, so its
 * refusals are translated here rather than leaked: a stored row that breaks
 * its contract keeps that meaning and every other reason is a storage failure.
 */
function fromTransactionResult(
  result: TransactionResult<readonly Transaction[]>,
): AnalyticsResult<readonly Transaction[]> {
  if (result.ok) {
    return succeeded(result.value);
  }

  const error: TransactionRepositoryError = result.error;

  if (error.code === "invalidStoredRow") {
    return failed("invalidStoredRow", error.cause);
  }

  return failed("storageFailure", error.cause);
}

/** Analytics read port backed by a real SQLite file. */
export const sqliteAnalyticsRepository: AnalyticsRepository<SqliteUnitOfWork> =
  {
    readTypeTotals,
    readMonthlyTotals,
    readExpenseByCategory,
    readExpenseByTag,
    findFirstTransactionDate,
    readRecentTransactions,
  };
