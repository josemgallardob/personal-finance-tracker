/**
 * Real-file setup for the classification repository tests.
 *
 * Every fixture migrates and bootstraps an isolated SQLite file with the
 * production PRAGMAs. Nothing here stubs the driver, the constraints or the
 * repositories under test; a second connection to the same file is a real
 * second writer, not a simulated one.
 */

import { randomUUID } from "node:crypto";

import type { TransactionType } from "../../../src/modules/transactions/domain/transaction-type";
import type {
  ClassificationRepositoryErrorCode,
  ClassificationResult,
} from "../../../src/modules/classification/application/ports/classification-repository";
import {
  type Category,
  createCategory,
} from "../../../src/modules/classification/domain/category";
import {
  type Tag,
  createTag,
} from "../../../src/modules/classification/domain/tag";
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

/** Migrated database with the personal workspace and real extra writers. */
export interface ClassificationFixture {
  readonly connection: SqliteConnection;
  readonly workspaceId: string;
  /** Opens another connection to the same file, closed by {@link cleanup}. */
  openWriter(): SqliteConnection;
  cleanup(): void;
}

/** Opens a temporary file, applies the committed migrations and bootstraps it. */
export function createClassificationFixture(): ClassificationFixture {
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
  });

  if (!initialized.ok) {
    opened.value.close();
    file.cleanup();
    throw new Error(
      `Expected a migrated database: ${JSON.stringify(initialized)}`,
    );
  }

  const writers: SqliteConnection[] = [];

  return {
    connection: opened.value,
    workspaceId: initialized.value.workspaceId,
    openWriter(): SqliteConnection {
      const writer = openSqliteConnection(config.value);

      if (!writer.ok) {
        throw new Error(`Expected a second writer: ${JSON.stringify(writer)}`);
      }

      writers.push(writer.value);
      return writer.value;
    },
    cleanup(): void {
      for (const writer of writers) {
        writer.close();
      }

      opened.value.close();
      file.cleanup();
    },
  };
}

/** Builds a category through the domain contract that guards its fields. */
export function newCategory(
  name: string,
  type: TransactionType,
  sortOrder: number,
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

  return built.value;
}

/** Builds a tag through the domain contract that guards its fields. */
export function newTag(name: string): Tag {
  const built = createTag({ id: randomUUID(), name, archivedAt: null });

  if (!built.ok) {
    throw new Error(`Expected a valid tag: ${JSON.stringify(built)}`);
  }

  return built.value;
}

/** Value of an accepted outcome; fails loudly when it was refused. */
export function okValue<TValue>(result: ClassificationResult<TValue>): TValue {
  if (!result.ok) {
    throw new Error(`Expected success: ${JSON.stringify(result.error)}`);
  }

  return result.value;
}

/** Refusal code of an outcome, or `"ok"` when it unexpectedly succeeded. */
export function errorCode(
  result: ClassificationResult<unknown>,
): ClassificationRepositoryErrorCode | "ok" {
  return result.ok ? "ok" : result.error.code;
}
