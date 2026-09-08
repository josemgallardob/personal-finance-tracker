/**
 * Real-file fixtures for the API foundation tests.
 *
 * The pipeline is exercised against a migrated SQLite file, the real domain
 * services and real `Request`/`Response` objects. Nothing here stubs the
 * parser, the origin check, the workspace lookup or the storage adapters: the
 * only injected collaborators are the environment map, the clock and the log
 * sink, which are the process boundaries a test must own to stay deterministic.
 */

import { randomUUID } from "node:crypto";

import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import { autocommitUnitOfWork as classificationUnit } from "../../../src/modules/classification/infrastructure/sqlite-unit-of-work";
import {
  type Category,
  createCategory,
} from "../../../src/modules/classification/domain/category";
import type { TransactionType } from "../../../src/modules/transactions/domain/transaction-type";
import {
  type EnvSource,
  loadAppConfig,
} from "../../../src/shared/server/config";
import {
  openSqliteConnection,
  type SqliteConnection,
} from "../../../src/shared/server/database";
import type { ApiLogEntry } from "../../../src/shared/server/http/logging";
import { initializeDatabase } from "../../../src/shared/server/initialize";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
} from "../helpers/sqlite";

/** Origin the fixtures configure as the private application origin. */
export const APP_ORIGIN = "http://localhost:3000";

/** Migrated database with the implicit personal workspace. */
export interface HttpFixture {
  readonly connection: SqliteConnection;
  readonly workspaceId: string;
  readonly env: EnvSource;
  cleanup(): void;
}

/** Opens a temporary file and applies the committed migrations to it. */
export function createHttpFixture(): HttpFixture {
  const file = createTemporarySqliteFile();
  const env = createValidAppEnv(file.filePath, { APP_URL: APP_ORIGIN });
  const config = loadAppConfig(env);

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
    env,
    cleanup(): void {
      opened.value.close();
      file.cleanup();
    },
  };
}

/** Stores a category through the real classification adapter. */
export function storeCategory(
  fixture: HttpFixture,
  name: string,
  type: TransactionType,
  archivedAt: number | null = null,
): Category {
  const built = createCategory({
    id: randomUUID(),
    name,
    type,
    sortOrder: 0,
    archivedAt,
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

/** Values a test request is built from. */
export interface RequestDraft {
  readonly method?: string;
  readonly path?: string;
  readonly origin?: string | null;
  readonly contentType?: string | null;
  readonly body?: BodyInit | null;
  readonly requestId?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Builds a real `Request` aimed at the application origin. */
export function buildRequest(draft: RequestDraft = {}): Request {
  const headers = new Headers(draft.headers ?? {});
  const method = draft.method ?? "GET";

  if (draft.origin !== null) {
    headers.set("origin", draft.origin ?? APP_ORIGIN);
  }

  if (draft.contentType !== null) {
    headers.set("content-type", draft.contentType ?? "application/json");
  }

  if (draft.requestId !== undefined) {
    headers.set("x-request-id", draft.requestId);
  }

  return new Request(`${APP_ORIGIN}${draft.path ?? "/api/test"}`, {
    method,
    headers,
    body: draft.body ?? null,
  });
}

/** Collects log entries so a test can assert what was and was not recorded. */
export function createLogCollector(): {
  readonly entries: ApiLogEntry[];
  readonly logger: (entry: ApiLogEntry) => void;
} {
  const entries: ApiLogEntry[] = [];

  return {
    entries,
    logger(entry: ApiLogEntry): void {
      entries.push(entry);
    },
  };
}

/** Parsed JSON body of a response. */
export async function readEnvelope(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

/**
 * Opens a connection from an environment map, exactly as the process does.
 *
 * This is the real composition used by the application, minus the
 * process-wide singleton that would leak one test's file into the next.
 */
export function openConnectionFrom(source: EnvSource) {
  const config = loadAppConfig(source);

  if (!config.ok) {
    return {
      ok: false as const,
      error: { code: "invalidConfig" as const, configErrors: config.errors },
    };
  }

  return openSqliteConnection(config.value);
}
