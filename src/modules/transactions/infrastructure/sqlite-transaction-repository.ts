/**
 * SQLite adapter of the transaction port.
 *
 * It runs on the handle the caller owns, carries the workspace in every
 * statement and rebuilds stored rows through the domain contract before
 * returning them. Reads join the category the movement is classified with and
 * load every association of the batch in one further statement, so the number
 * of statements does not grow with the number of movements or tags. Writes let
 * the constraints of the schema decide identity, workspace membership and the
 * compatibility between a movement and its category; only when a write is
 * refused does the adapter ask the database which reference was missing.
 */

import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  category,
  transaction,
  transactionTag,
  workspace,
} from "../../../../db/schema";
import {
  type Category,
  createCategory,
} from "../../classification/domain/category";
import type { TagId } from "../../classification/domain/tag";
import {
  type TransactionResult,
  type DeleteTransactionCommand,
  type InsertTransactionCommand,
  type TransactionByIdQuery,
  type TransactionRepository,
  type TransactionsByIdsQuery,
  type UpdateTransactionCommand,
  failed,
  succeeded,
} from "../application/ports/transaction-repository";
import {
  type Transaction,
  type TransactionId,
  createTransaction,
} from "../domain/transaction";
import {
  describeCause,
  isForeignKeyViolation,
  isUniqueViolation,
} from "./sqlite-errors";
import type { SqliteUnitOfWork } from "./sqlite-unit-of-work";

/** Movement joined with the category that classifies it, as stored. */
interface TransactionRow {
  readonly id: string;
  readonly type: string;
  readonly amountMinor: number;
  readonly date: string;
  readonly concept: string | null;
  readonly note: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly categoryType: string;
  readonly categorySortOrder: number;
  readonly categoryArchivedAt: number | null;
}

/** Association row of the batch that carries the tags of every movement. */
interface AssociationRow {
  readonly transactionId: string;
  readonly tagId: string;
}

const SELECTED_COLUMNS = {
  id: transaction.id,
  type: transaction.type,
  amountMinor: transaction.amountMinor,
  date: transaction.date,
  concept: transaction.concept,
  note: transaction.note,
  createdAt: transaction.createdAt,
  updatedAt: transaction.updatedAt,
  categoryId: category.id,
  categoryName: category.name,
  categoryType: category.type,
  categorySortOrder: category.sortOrder,
  categoryArchivedAt: category.archivedAt,
};

function findTransactionById(
  unit: SqliteUnitOfWork,
  query: TransactionByIdQuery,
): TransactionResult<Transaction | null> {
  const found = findTransactionsByIds(unit, {
    workspaceId: query.workspaceId,
    transactionIds: [query.transactionId],
  });

  if (!found.ok) {
    return found;
  }

  const [stored] = found.value;

  return succeeded(stored ?? null);
}

/**
 * Reads a batch of movements with their tags in two statements.
 *
 * The first statement joins the category, which is required to rebuild the
 * movement through its domain contract. The second loads every association of
 * the batch at once, so a batch of a hundred movements costs the same two
 * statements as a batch of one.
 */
function findTransactionsByIds(
  unit: SqliteUnitOfWork,
  query: TransactionsByIdsQuery,
): TransactionResult<readonly Transaction[]> {
  if (query.transactionIds.length === 0) {
    return succeeded([]);
  }

  let rows: TransactionRow[];

  try {
    rows = unit.db
      .select(SELECTED_COLUMNS)
      .from(transaction)
      .innerJoin(
        category,
        and(
          eq(category.id, transaction.categoryId),
          eq(category.workspaceId, transaction.workspaceId),
        ),
      )
      .where(
        and(
          eq(transaction.workspaceId, query.workspaceId),
          inArray(transaction.id, [...query.transactionIds]),
        ),
      )
      .orderBy(
        desc(transaction.date),
        desc(transaction.createdAt),
        desc(transaction.id),
      )
      .all();
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }

  if (rows.length === 0) {
    return succeeded([]);
  }

  const associations = selectAssociations(
    unit,
    query.workspaceId,
    rows.map((row) => row.id),
  );

  if (!associations.ok) {
    return associations;
  }

  const built: Transaction[] = [];

  for (const row of rows) {
    const stored = toTransaction(row, associations.value.get(row.id) ?? []);

    if (!stored.ok) {
      return stored;
    }

    built.push(stored.value);
  }

  return succeeded(built);
}

function insertTransaction(
  unit: SqliteUnitOfWork,
  command: InsertTransactionCommand,
): TransactionResult<Transaction> {
  if (!unit.isTransactional) {
    return failed("transactionRequired");
  }

  const stored = command.transaction;

  try {
    unit.db
      .insert(transaction)
      .values({
        id: stored.id,
        workspaceId: command.workspaceId,
        type: stored.type,
        amountMinor: stored.amountMinor,
        date: stored.date,
        categoryId: stored.categoryId,
        concept: stored.concept,
        note: stored.note,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      })
      .run();
  } catch (cause) {
    return movementWriteFailure(unit, command.workspaceId, cause);
  }

  const associated = insertAssociations(unit, command.workspaceId, stored);

  if (!associated.ok) {
    return associated;
  }

  return succeeded(stored);
}

function updateTransaction(
  unit: SqliteUnitOfWork,
  command: UpdateTransactionCommand,
): TransactionResult<Transaction> {
  if (!unit.isTransactional) {
    return failed("transactionRequired");
  }

  const stored = command.transaction;
  let updated: { readonly id: string }[];

  try {
    updated = unit.db
      .update(transaction)
      .set({
        type: stored.type,
        amountMinor: stored.amountMinor,
        date: stored.date,
        categoryId: stored.categoryId,
        concept: stored.concept,
        note: stored.note,
        updatedAt: stored.updatedAt,
      })
      .where(
        and(
          eq(transaction.workspaceId, command.workspaceId),
          eq(transaction.id, stored.id),
        ),
      )
      .returning({ id: transaction.id })
      .all();
  } catch (cause) {
    return movementWriteFailure(unit, command.workspaceId, cause);
  }

  if (updated.length === 0) {
    return failed("transactionNotFound");
  }

  try {
    unit.db
      .delete(transactionTag)
      .where(
        and(
          eq(transactionTag.workspaceId, command.workspaceId),
          eq(transactionTag.transactionId, stored.id),
        ),
      )
      .run();
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }

  const associated = insertAssociations(unit, command.workspaceId, stored);

  if (!associated.ok) {
    return associated;
  }

  return succeeded(stored);
}

/**
 * Deletes a movement of the workspace.
 *
 * The association rows carry a cascading foreign key, so one statement removes
 * the movement and its associations atomically and no unit of work of its own
 * is needed. The categories and tags it used are not touched.
 */
function deleteTransaction(
  unit: SqliteUnitOfWork,
  command: DeleteTransactionCommand,
): TransactionResult<TransactionId> {
  let removed: { readonly id: string }[];

  try {
    removed = unit.db
      .delete(transaction)
      .where(
        and(
          eq(transaction.workspaceId, command.workspaceId),
          eq(transaction.id, command.transactionId),
        ),
      )
      .returning({ id: transaction.id })
      .all();
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }

  if (removed.length === 0) {
    return failed("transactionNotFound");
  }

  return succeeded(command.transactionId);
}

/** Writes the tag set of a movement, in one statement or in none at all. */
function insertAssociations(
  unit: SqliteUnitOfWork,
  workspaceId: string,
  stored: Transaction,
): TransactionResult<null> {
  if (stored.tagIds.length === 0) {
    return succeeded(null);
  }

  try {
    unit.db
      .insert(transactionTag)
      .values(
        stored.tagIds.map((tagId) => ({
          transactionId: stored.id,
          tagId,
          workspaceId,
        })),
      )
      .run();
  } catch (cause) {
    if (isForeignKeyViolation(cause)) {
      return failed("unknownTag", describeCause(cause));
    }

    return failed("storageFailure", describeCause(cause));
  }

  return succeeded(null);
}

function selectAssociations(
  unit: SqliteUnitOfWork,
  workspaceId: string,
  transactionIds: readonly string[],
): TransactionResult<ReadonlyMap<string, readonly TagId[]>> {
  let rows: AssociationRow[];

  try {
    rows = unit.db
      .select({
        transactionId: transactionTag.transactionId,
        tagId: transactionTag.tagId,
      })
      .from(transactionTag)
      .where(
        and(
          eq(transactionTag.workspaceId, workspaceId),
          inArray(transactionTag.transactionId, [...transactionIds]),
        ),
      )
      .orderBy(asc(transactionTag.transactionId), asc(transactionTag.tagId))
      .all();
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }

  const grouped = new Map<string, TagId[]>();

  for (const row of rows) {
    const tagIds = grouped.get(row.transactionId) ?? [];

    tagIds.push(row.tagId as TagId);
    grouped.set(row.transactionId, tagIds);
  }

  return succeeded(grouped);
}

/**
 * Explains why a movement row was refused.
 *
 * A repeated identifier is a duplicate. Every foreign key of the movement row
 * points either at the workspace or at the category that classifies it, so one
 * scoped lookup separates the two, and it runs on the failure path only. When
 * the workspace exists, the reference that failed is the category: it does not
 * belong to the workspace, or its type is not the type of the movement.
 */
function movementWriteFailure(
  unit: SqliteUnitOfWork,
  workspaceId: string,
  cause: unknown,
): TransactionResult<Transaction> {
  if (isUniqueViolation(cause)) {
    return failed("duplicateId", describeCause(cause));
  }

  if (!isForeignKeyViolation(cause)) {
    return failed("storageFailure", describeCause(cause));
  }

  let workspaces: { readonly id: string }[];

  try {
    workspaces = unit.db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .all();
  } catch (lookupCause) {
    return failed("storageFailure", describeCause(lookupCause));
  }

  if (workspaces.length === 0) {
    return failed("unknownWorkspace", describeCause(cause));
  }

  return failed("unknownCategory", describeCause(cause));
}

/** Rebuilds a stored row and its tags through the domain contract. */
function toTransaction(
  row: TransactionRow,
  tagIds: readonly TagId[],
): TransactionResult<Transaction> {
  const classified = toCategory(row);

  if (!classified.ok) {
    return classified;
  }

  const built = createTransaction({
    id: row.id,
    type: row.type,
    amountMinor: row.amountMinor,
    date: row.date,
    category: classified.value,
    concept: row.concept,
    note: row.note,
    tagIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  if (!built.ok) {
    return failed(
      "invalidStoredRow",
      built.errors.map((error) => `${error.field}:${error.code}`).join(","),
    );
  }

  return succeeded(built.value);
}

function toCategory(row: TransactionRow): TransactionResult<Category> {
  const built = createCategory({
    id: row.categoryId,
    name: row.categoryName,
    type: row.categoryType,
    sortOrder: row.categorySortOrder,
    archivedAt: row.categoryArchivedAt,
  });

  if (!built.ok) {
    return failed(
      "invalidStoredRow",
      built.errors
        .map((error) => `category.${error.field}:${error.code}`)
        .join(","),
    );
  }

  return succeeded(built.value);
}

/** Transaction port backed by a real SQLite file. */
export const sqliteTransactionRepository: TransactionRepository<SqliteUnitOfWork> =
  {
    findTransactionById,
    findTransactionsByIds,
    insertTransaction,
    updateTransaction,
    deleteTransaction,
  };
