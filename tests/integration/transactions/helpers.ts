/**
 * Real-file setup for the transaction repository tests.
 *
 * Every fixture migrates and bootstraps an isolated SQLite file with the
 * production PRAGMAs, then writes its categories and tags through the real
 * classification adapters. Nothing here stubs the driver, the constraints or
 * the repository under test: the statement counter below wraps the real
 * `prepare` of better-sqlite3 to observe how many statements a read issues,
 * and every statement it counts still runs against the file.
 */

import { randomUUID } from "node:crypto";

import { autocommitUnitOfWork as classificationUnit } from "../../../src/modules/classification/infrastructure/sqlite-unit-of-work";
import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../../../src/modules/classification/infrastructure/sqlite-tag-repository";
import {
  type Category,
  createCategory,
} from "../../../src/modules/classification/domain/category";
import {
  type Tag,
  createTag,
} from "../../../src/modules/classification/domain/tag";
import type {
  TransactionRepositoryErrorCode,
  TransactionResult,
} from "../../../src/modules/transactions/application/ports/transaction-repository";
import {
  type Transaction,
  createTransaction,
} from "../../../src/modules/transactions/domain/transaction";
import type { TransactionType } from "../../../src/modules/transactions/domain/transaction-type";
import { loadAppConfig } from "../../../src/shared/server/config";
import {
  openSqliteConnection,
  type SqliteConnection,
} from "../../../src/shared/server/database";
import { initializeDatabase } from "../../../src/shared/server/initialize";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
} from "../helpers/sqlite";

/** Migrated database with the personal workspace and no seeded catalog. */
export interface TransactionFixture {
  readonly connection: SqliteConnection;
  readonly workspaceId: string;
  cleanup(): void;
}

/**
 * Opens a temporary file, applies the committed migrations and bootstraps it.
 *
 * The accepted category catalog is left out on purpose: these fixtures prove
 * repository behaviour with the caller's own rows, without colliding with the
 * seed identifiers.
 */
export function createTransactionFixture(): TransactionFixture {
  const file = createTemporarySqliteFile();
  const config = loadAppConfig(createValidAppEnv(file.filePath));

  if (!config.ok) {
    file.cleanup();
    throw new Error(`Expected valid configuration: ${JSON.stringify(config)}`);
  }

  const opened = openSqliteConnection(config.value);

  if (!opened.ok) {
    file.cleanup();
    throw new Error(`Expected an open connection: ${JSON.stringify(opened)}`);
  }

  const initialized = initializeDatabase(opened.value, {
    now: () => 1_746_268_800_000,
    seedCategories: false,
  });

  if (!initialized.ok) {
    opened.value.close();
    file.cleanup();
    throw new Error(
      `Expected a migrated database: ${JSON.stringify(initialized)}`,
    );
  }

  return {
    connection: opened.value,
    workspaceId: initialized.value.workspaceId,
    cleanup(): void {
      opened.value.close();
      file.cleanup();
    },
  };
}

/** Stores a category through the real classification adapter. */
export function storeCategory(
  fixture: TransactionFixture,
  name: string,
  type: TransactionType,
  sortOrder = 0,
): Category {
  const built = createCategory({
    id: randomUUID(),
    name,
    type,
    sortOrder,
    archivedAt: null,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid category: ${JSON.stringify(built)}`);
  }

  const inserted = sqliteCategoryRepository.insertCategory(
    classificationUnit(fixture.connection),
    { workspaceId: fixture.workspaceId, category: built.value },
  );

  if (!inserted.ok) {
    throw new Error(`Expected a stored category: ${JSON.stringify(inserted)}`);
  }

  return inserted.value;
}

/** Stores a tag through the real classification adapter. */
export function storeTag(fixture: TransactionFixture, name: string): Tag {
  const built = createTag({ id: randomUUID(), name, archivedAt: null });

  if (!built.ok) {
    throw new Error(`Expected a valid tag: ${JSON.stringify(built)}`);
  }

  const inserted = sqliteTagRepository.insertTag(
    classificationUnit(fixture.connection),
    { workspaceId: fixture.workspaceId, tag: built.value },
  );

  if (!inserted.ok) {
    throw new Error(`Expected a stored tag: ${JSON.stringify(inserted)}`);
  }

  return inserted.value;
}

/** Values a test movement is built from, with sensible defaults. */
export interface TransactionDraft {
  readonly id?: string;
  readonly category: Category;
  readonly amountMinor?: number;
  readonly date?: string;
  readonly concept?: string | null;
  readonly note?: string | null;
  readonly tagIds?: readonly string[];
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

/** Builds a movement through the domain contract that guards its fields. */
export function newTransaction(draft: TransactionDraft): Transaction {
  const built = createTransaction({
    id: draft.id ?? randomUUID(),
    type: draft.category.type,
    amountMinor: draft.amountMinor ?? 1_250,
    date: draft.date ?? "2026-03-14",
    category: draft.category,
    concept: draft.concept ?? null,
    note: draft.note ?? null,
    tagIds: draft.tagIds ?? [],
    createdAt: draft.createdAt ?? 1_746_268_800_000,
    updatedAt: draft.updatedAt ?? 1_746_268_800_000,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid transaction: ${JSON.stringify(built)}`);
  }

  return built.value;
}

/** Value of an accepted outcome; fails loudly when it was refused. */
export function okValue<TValue>(result: TransactionResult<TValue>): TValue {
  if (!result.ok) {
    throw new Error(`Expected success: ${JSON.stringify(result.error)}`);
  }

  return result.value;
}

/** Refusal code of an outcome, or `"ok"` when it unexpectedly succeeded. */
export function errorCode(
  result: TransactionResult<unknown>,
): TransactionRepositoryErrorCode | "ok" {
  return result.ok ? "ok" : result.error.code;
}

/** Outcome of `work` together with the SQL statements it prepared. */
export interface CountedWork<TValue> {
  readonly value: TValue;
  readonly statements: number;
}

/**
 * Counts the SQL statements `work` prepares on the real connection.
 *
 * The wrapper delegates to the original `prepare`, so every counted statement
 * is really executed against the file. It exists to prove that a read does not
 * issue one association query per movement.
 */
export function countStatements<TValue>(
  fixture: TransactionFixture,
  work: () => TValue,
): CountedWork<TValue> {
  const sqlite = fixture.connection.sqlite;
  const original = sqlite.prepare.bind(sqlite);
  let statements = 0;

  sqlite.prepare = ((source: string) => {
    statements += 1;
    return original(source);
  }) as typeof sqlite.prepare;

  try {
    return { value: work(), statements };
  } finally {
    sqlite.prepare = original;
  }
}
