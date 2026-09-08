/**
 * Real-file setup for the analytics repository tests.
 *
 * The fixtures reuse the transaction ones: an isolated SQLite file with the
 * production PRAGMAs, the committed migrations and the personal workspace, and
 * categories, tags and movements written through the real adapters. Nothing
 * here stubs the driver, the constraints or the repository under test.
 */

import { randomUUID } from "node:crypto";

import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../../../src/modules/classification/infrastructure/sqlite-tag-repository";
import { autocommitUnitOfWork as classificationUnit } from "../../../src/modules/classification/infrastructure/sqlite-unit-of-work";
import type { Category } from "../../../src/modules/classification/domain/category";
import type { Tag } from "../../../src/modules/classification/domain/tag";
import { sqliteTransactionRepository } from "../../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import { runInTransaction } from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";
import type { Transaction } from "../../../src/modules/transactions/domain/transaction";
import type { Timestamp } from "../../../src/shared/domain/timestamp";
import type {
  AnalyticsRepositoryErrorCode,
  AnalyticsResult,
} from "../../../src/modules/analytics/application/ports/analytics-repository";
import {
  type TransactionDraft,
  type TransactionFixture,
  newTransaction,
} from "../transactions/helpers";

export {
  createTransactionFixture as createAnalyticsFixture,
  storeCategory,
  storeTag,
  type TransactionFixture as AnalyticsFixture,
} from "../transactions/helpers";

/** Instant used as the archiving timestamp of the fixtures. */
export const ARCHIVED_AT = 1_746_268_800_000 as Timestamp;

/** Writes a movement and its associations through the real adapter. */
export function storeTransaction(
  fixture: TransactionFixture,
  draft: TransactionDraft,
): Transaction {
  const stored = runInTransaction(fixture.connection, (unit) =>
    sqliteTransactionRepository.insertTransaction(unit, {
      workspaceId: fixture.workspaceId,
      transaction: newTransaction({ id: randomUUID(), ...draft }),
    }),
  );

  if (!stored.ok) {
    throw new Error(`Expected a stored movement: ${JSON.stringify(stored)}`);
  }

  return stored.value;
}

/** Archives a stored category through the real classification adapter. */
export function archiveCategory(
  fixture: TransactionFixture,
  stored: Category,
): Category {
  const archived = sqliteCategoryRepository.archiveCategory(
    classificationUnit(fixture.connection),
    {
      workspaceId: fixture.workspaceId,
      categoryId: stored.id,
      archivedAt: ARCHIVED_AT,
    },
  );

  if (!archived.ok) {
    throw new Error(
      `Expected an archived category: ${JSON.stringify(archived)}`,
    );
  }

  return archived.value;
}

/** Archives a stored tag through the real classification adapter. */
export function archiveTag(fixture: TransactionFixture, stored: Tag): Tag {
  const archived = sqliteTagRepository.archiveTag(
    classificationUnit(fixture.connection),
    {
      workspaceId: fixture.workspaceId,
      tagId: stored.id,
      archivedAt: ARCHIVED_AT,
    },
  );

  if (!archived.ok) {
    throw new Error(`Expected an archived tag: ${JSON.stringify(archived)}`);
  }

  return archived.value;
}

/** Value of an accepted aggregation; fails loudly when it was refused. */
export function okValue<TValue>(result: AnalyticsResult<TValue>): TValue {
  if (!result.ok) {
    throw new Error(`Expected success: ${JSON.stringify(result.error)}`);
  }

  return result.value;
}

/** Refusal code of an aggregation, or `"ok"` when it unexpectedly succeeded. */
export function errorCode(
  result: AnalyticsResult<unknown>,
): AnalyticsRepositoryErrorCode | "ok" {
  return result.ok ? "ok" : result.error.code;
}
