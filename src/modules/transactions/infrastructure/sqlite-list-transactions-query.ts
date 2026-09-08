/**
 * SQLite adapter of the history-list query.
 *
 * Filters are AND across dimensions and OR across tags, expressed with EXISTS
 * so a movement that carries several selected tags is not duplicated. Text is
 * a literal substring of concept or note: SQL wildcards in the search are
 * escaped. A page that is not already inside a caller transaction runs in one
 * read snapshot so its rows and associations cannot split across a writer.
 */

import "server-only";

import {
  and,
  desc,
  eq,
  exists,
  gte,
  inArray,
  lt,
  lte,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { transaction, transactionTag } from "../../../../db/schema";
import {
  escapeLikeLiteral,
  type NormalizedTransactionListQuery,
} from "../application/list-transaction-filters";
import type {
  TransactionListPage,
  TransactionQuery,
} from "../application/ports/transaction-query";
import {
  type TransactionResult,
  failed,
  succeeded,
} from "../application/ports/transaction-repository";
import type { TransactionId } from "../domain/transaction";
import { sqliteTransactionRepository } from "./sqlite-transaction-repository";
import { describeCause } from "./sqlite-errors";
import type { SqliteUnitOfWork } from "./sqlite-unit-of-work";

function listTransactions(
  unit: SqliteUnitOfWork,
  query: NormalizedTransactionListQuery,
): TransactionResult<TransactionListPage> {
  if (unit.isTransactional) {
    return listPage(unit, query);
  }

  try {
    return unit.db.transaction((tx) =>
      listPage({ isTransactional: true, db: tx }, query),
    );
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }
}

function listPage(
  unit: SqliteUnitOfWork,
  query: NormalizedTransactionListQuery,
): TransactionResult<TransactionListPage> {
  let rows: { readonly id: string }[];

  try {
    rows = unit.db
      .select({ id: transaction.id })
      .from(transaction)
      .where(listConditions(unit, query))
      .orderBy(
        desc(transaction.date),
        desc(transaction.createdAt),
        desc(transaction.id),
      )
      .limit(query.limit + 1)
      .all();
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }

  const hasNextPage = rows.length > query.limit;
  const pageIds = rows
    .slice(0, query.limit)
    .map((row) => row.id as TransactionId);

  const items = sqliteTransactionRepository.findTransactionsByIds(unit, {
    workspaceId: query.workspaceId,
    transactionIds: pageIds,
  });

  if (!items.ok) {
    return items;
  }

  return succeeded({ items: items.value, hasNextPage });
}

function listConditions(
  unit: SqliteUnitOfWork,
  query: NormalizedTransactionListQuery,
): SQL | undefined {
  const conditions: SQL[] = [eq(transaction.workspaceId, query.workspaceId)];

  if (query.dateFrom !== null) {
    conditions.push(gte(transaction.date, query.dateFrom));
  }

  if (query.dateTo !== null) {
    conditions.push(lte(transaction.date, query.dateTo));
  }

  if (query.type !== null) {
    conditions.push(eq(transaction.type, query.type));
  }

  if (query.categoryId !== null) {
    conditions.push(eq(transaction.categoryId, query.categoryId));
  }

  if (query.textQuery !== null) {
    const pattern = `%${escapeLikeLiteral(query.textQuery)}%`;

    conditions.push(
      sql`(${transaction.concept} like ${pattern} escape '!' or ${transaction.note} like ${pattern} escape '!')`,
    );
  }

  if (query.tagIds.length > 0) {
    conditions.push(
      exists(
        unit.db
          .select({ one: sql`1` })
          .from(transactionTag)
          .where(
            and(
              eq(transactionTag.transactionId, transaction.id),
              eq(transactionTag.workspaceId, query.workspaceId),
              inArray(transactionTag.tagId, [...query.tagIds]),
            ),
          ),
      ),
    );
  }

  if (query.untagged) {
    conditions.push(
      notExists(
        unit.db
          .select({ one: sql`1` })
          .from(transactionTag)
          .where(
            and(
              eq(transactionTag.transactionId, transaction.id),
              eq(transactionTag.workspaceId, query.workspaceId),
            ),
          ),
      ),
    );
  }

  if (query.after !== null) {
    const after = query.after;

    const afterKeyset = or(
      lt(transaction.date, after.date),
      and(
        eq(transaction.date, after.date),
        lt(transaction.createdAt, after.createdAt),
      ),
      and(
        eq(transaction.date, after.date),
        eq(transaction.createdAt, after.createdAt),
        lt(transaction.id, after.id),
      ),
    );

    if (afterKeyset) {
      conditions.push(afterKeyset);
    }
  }

  return and(...conditions);
}

/** History-list query backed by a real SQLite file. */
export const sqliteTransactionQuery: TransactionQuery<SqliteUnitOfWork> = {
  listTransactions,
};
