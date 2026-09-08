/**
 * Transaction HTTP helpers and route wiring.
 *
 * Path identifiers, repository refusals and the documented Node runtime of
 * every transaction route are checked here. The collection handlers are
 * exercised with a real SQLite file in the sibling endpoint tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as transactionsCollection from "../../../src/app/api/transactions/route";
import * as transactionItem from "../../../src/app/api/transactions/[id]/route";
import {
  API_DYNAMIC,
  API_REVALIDATE,
  API_RUNTIME,
} from "../../../src/shared/server/http";
import {
  failed,
  type TransactionRepositoryErrorCode,
} from "../../../src/modules/transactions/application/ports/transaction-repository";
import {
  fromTransaction,
  runDomainInTransaction,
  tagIdsFromQuery,
  toDomainError,
  transactionIdFrom,
} from "../../../src/modules/transactions/server/http";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
} from "../helpers/sqlite";
import { buildRequest, createHttpFixture, type HttpFixture } from "./helpers";
import { valid } from "../../../src/shared/domain/errors";

let fixture: HttpFixture;

beforeEach(() => {
  fixture = createHttpFixture();
});

afterEach(() => {
  fixture.cleanup();
  vi.unstubAllEnvs();
});

describe("transaction path identifiers", () => {
  it("reads a movement identifier and refuses neighbouring paths", () => {
    expect(
      transactionIdFrom(new URL("http://localhost:3000/api/transactions/abc")),
    ).toEqual({ ok: true, value: "abc" });
    expect(
      transactionIdFrom(
        new URL("http://localhost:3000/api/transactions/tx%2Did"),
      ),
    ).toEqual({ ok: true, value: "tx-id" });
    expect(
      transactionIdFrom(new URL("http://localhost:3000/api/transactions")),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "notFound" }),
    });
    expect(
      transactionIdFrom(
        new URL("http://localhost:3000/api/transactions/abc/extra"),
      ),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "notFound" }),
    });
    expect(
      transactionIdFrom(new URL("http://localhost:3000/api/categories/abc")),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "notFound" }),
    });
  });
});

describe("transaction query helpers", () => {
  it("normalises a single or repeated tag identifier", () => {
    expect(tagIdsFromQuery(undefined)).toBeUndefined();
    expect(tagIdsFromQuery("tag-1")).toEqual(["tag-1"]);
    expect(tagIdsFromQuery(["tag-1", "tag-2"])).toEqual(["tag-1", "tag-2"]);
  });
});

describe("transaction refusal mapping", () => {
  it("maps every repository refusal to a named domain error", () => {
    const error = (code: TransactionRepositoryErrorCode) => ({ code });

    expect(toDomainError(error("duplicateId"))).toEqual({
      field: "id",
      code: "invalidIdentifier",
    });
    expect(toDomainError(error("transactionNotFound"))).toEqual({
      field: "id",
      code: "notFound",
    });
    expect(toDomainError(error("unknownCategory"))).toEqual({
      field: "categoryId",
      code: "notFound",
    });
    expect(toDomainError(error("unknownTag"))).toEqual({
      field: "tagId",
      code: "notFound",
    });
    expect(toDomainError(error("unknownWorkspace"))).toEqual({
      field: "workspaceId",
      code: "notFound",
    });
    expect(toDomainError(error("transactionRequired"))).toEqual({
      field: "storage",
      code: "unavailable",
    });
    expect(toDomainError(error("invalidStoredRow"))).toEqual({
      field: "storage",
      code: "unavailable",
    });
    expect(toDomainError(error("storageFailure"))).toEqual({
      field: "storage",
      code: "unavailable",
    });
  });

  it("accepts a stored transaction result", () => {
    expect(fromTransaction({ ok: true, value: { id: "tx-1" } })).toEqual({
      ok: true,
      value: { id: "tx-1" },
    });
    expect(fromTransaction(failed("transactionNotFound"))).toMatchObject({
      ok: false,
      failure: { code: "notFound" },
    });
  });
});

describe("runDomainInTransaction", () => {
  it("reports an unexpected throw as unavailable storage", () => {
    const result = runDomainInTransaction(fixture.connection, () => {
      throw new Error("driver boom");
    });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("commits an accepted domain result and rolls a refusal back", () => {
    expect(
      runDomainInTransaction(fixture.connection, () => valid("ok")),
    ).toEqual({ ok: true, value: "ok" });
    expect(
      runDomainInTransaction(fixture.connection, () => ({
        ok: false,
        errors: [{ field: "id", code: "notFound" }],
      })),
    ).toEqual({
      ok: false,
      errors: [{ field: "id", code: "notFound" }],
    });
  });
});

describe("transaction route modules", () => {
  it("declare the Node runtime and refuse an unconfigured process", async () => {
    const file = createTemporarySqliteFile();
    const env = createValidAppEnv(file.filePath);
    vi.stubEnv("DATABASE_PATH", env.DATABASE_PATH ?? "");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("TZ", env.TZ ?? "");

    expect(transactionsCollection.runtime).toBe(API_RUNTIME);
    expect(transactionsCollection.dynamic).toBe(API_DYNAMIC);
    expect(transactionsCollection.revalidate).toBe(API_REVALIDATE);
    expect(transactionItem.runtime).toBe(API_RUNTIME);
    expect(transactionItem.dynamic).toBe(API_DYNAMIC);
    expect(transactionItem.revalidate).toBe(API_REVALIDATE);

    const list = await transactionsCollection.GET(
      buildRequest({ path: "/api/transactions" }),
    );
    const create = await transactionsCollection.POST(
      buildRequest({
        method: "POST",
        path: "/api/transactions",
        body: JSON.stringify({
          type: "expense",
          amountMinor: 100,
          date: "2026-09-06",
          categoryId: "category-1",
        }),
      }),
    );
    const get = await transactionItem.GET(
      buildRequest({ path: "/api/transactions/id-1" }),
    );
    const update = await transactionItem.PUT(
      buildRequest({
        method: "PUT",
        path: "/api/transactions/id-1",
        body: JSON.stringify({
          type: "expense",
          amountMinor: 100,
          date: "2026-09-06",
          categoryId: "category-1",
        }),
      }),
    );
    const remove = await transactionItem.DELETE(
      buildRequest({ method: "DELETE", path: "/api/transactions/id-1" }),
    );

    expect(list.status).toBe(503);
    expect(create.status).toBe(503);
    expect(get.status).toBe(503);
    expect(update.status).toBe(503);
    expect(remove.status).toBe(503);
    file.cleanup();
  });
});
