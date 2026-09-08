/**
 * The API pipeline against a real, migrated SQLite file.
 *
 * The endpoint used here is the real manual-create use case wired to the real
 * SQLite adapters, so a `201` in these tests means a row was written and a
 * `409` means the stored classification refused it. Only three process
 * boundaries are injected: the environment map, the clock and the log sink.
 *
 * The cases walk every boundary the foundation owns: the order of the parse,
 * origin, size and workspace checks; the deterministic status of each refusal;
 * the caching and correlation headers; and the guarantee that no payload value
 * ever reaches a log line.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createCreateTransaction } from "../../../src/modules/transactions/application/create-transaction";
import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../../../src/modules/classification/infrastructure/sqlite-tag-repository";
import { sqliteTransactionRepository } from "../../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import type { SqliteUnitOfWork } from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";
import { autocommitUnitOfWork } from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";
import type { Transaction } from "../../../src/modules/transactions/domain/transaction";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate } from "../../../src/shared/domain/dates";
import type { DomainResult } from "../../../src/shared/domain/errors";
import { toApiFailure } from "../../../src/shared/server/http/domain-status";
import {
  accepted,
  apiFailure,
  refused,
  type ApiResult,
} from "../../../src/shared/server/http/failure";
import {
  createApiHandler,
  NO_CONTENT_STATUS,
  type ApiHandlerDeps,
  type ApiRequestContext,
  type ApiSuccess,
} from "../../../src/shared/server/http/handler";
import { MAX_REQUEST_BODY_BYTES } from "../../../src/shared/server/http/json-body";
import { apiObject } from "../../../src/shared/server/http/schema";
import {
  APP_ORIGIN,
  buildRequest,
  createHttpFixture,
  createLogCollector,
  openConnectionFrom,
  readEnvelope,
  storeCategory,
  type HttpFixture,
} from "./helpers";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
} from "../helpers/sqlite";

const TODAY = "2026-09-06" as LocalDate;
const NOW = 1_746_268_800_000;
const ROLLBACK_SIGNAL = new Error("Transaction work was rolled back");

let fixture: HttpFixture;
let logs: ReturnType<typeof createLogCollector>;
let ids: number;

beforeEach(() => {
  fixture = createHttpFixture();
  logs = createLogCollector();
  ids = 0;
});

afterEach(() => {
  fixture.cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function createId(): string {
  ids += 1;
  return `00000000-0000-4000-8000-00000000000${ids}`;
}

const createBodySchema = apiObject({
  type: z.enum(["expense", "income"]),
  amountMinor: z.int().positive(),
  date: z.string(),
  categoryId: z.string(),
  concept: z.string().max(200).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  tags: z
    .array(apiObject({ name: z.string() }))
    .max(20)
    .optional(),
});

type CreateBody = z.infer<typeof createBodySchema>;

/** Movement representation the endpoint returns. */
function toDto(transaction: Transaction) {
  return {
    id: transaction.id,
    type: transaction.type,
    amountMinor: transaction.amountMinor,
    date: transaction.date,
    categoryId: transaction.categoryId,
    tagIds: transaction.tagIds,
  };
}

function saveInTransaction(
  context: ApiRequestContext<CreateBody, undefined>,
): DomainResult<Transaction> {
  const useCase = createCreateTransaction({
    transactions: sqliteTransactionRepository,
    categories: sqliteCategoryRepository,
    tags: sqliteTagRepository,
    clock: new FixedClock(TODAY),
    createId,
    now: () => NOW,
  });
  let refusal: DomainResult<Transaction> | undefined;

  try {
    return context.connection.db.transaction((tx) => {
      const result = useCase.execute(
        { isTransactional: true, db: tx },
        {
          workspaceId: context.workspaceId,
          ...context.body,
          concept: context.body.concept ?? null,
          note: context.body.note ?? null,
        },
      );

      if (!result.ok) {
        refusal = result;
        throw ROLLBACK_SIGNAL;
      }

      return result;
    });
  } catch (cause) {
    if (refusal) {
      return refusal;
    }

    throw cause;
  }
}

function deps(overrides: ApiHandlerDeps = {}): ApiHandlerDeps {
  return {
    env: fixture.env,
    openConnection: openConnectionFrom,
    logger: logs.logger,
    now: () => NOW,
    ...overrides,
  };
}

/** The real create endpoint, wired to the real services and the real file. */
function createEndpoint(overrides: ApiHandlerDeps = {}) {
  return createApiHandler<CreateBody, undefined, ReturnType<typeof toDto>>(
    {
      bodySchema: createBodySchema,
      handle(context) {
        const result = saveInTransaction(context);

        if (!result.ok) {
          return refused(toApiFailure(result.errors));
        }

        return accepted({ status: 201, data: toDto(result.value) });
      },
    },
    deps(overrides),
  );
}

function countTransactions(): number {
  const row = fixture.connection.sqlite
    .prepare('SELECT COUNT(*) AS total FROM "transaction"')
    .get() as { total: number };

  return row.total;
}

function postRequest(
  body: unknown,
  overrides: Parameters<typeof buildRequest>[0] = {},
): Request {
  return buildRequest({
    method: "POST",
    path: "/api/transactions",
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...overrides,
  });
}

function validBody(categoryId: string) {
  return {
    type: "expense" as const,
    amountMinor: 1250,
    date: "2026-03-14",
    categoryId,
    concept: "Compra semanal",
    note: "Detalle privado",
    tags: [{ name: "hogar" }],
  };
}

describe("accepted requests", () => {
  it("saves a movement and answers the data envelope", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");
    const response = await createEndpoint()(
      postRequest(validBody(category.id), { requestId: "req-create" }),
    );

    expect(response.status).toBe(201);
    await expect(readEnvelope(response)).resolves.toEqual({
      data: {
        id: "00000000-0000-4000-8000-000000000002",
        type: "expense",
        amountMinor: 1250,
        date: "2026-03-14",
        categoryId: category.id,
        tagIds: ["00000000-0000-4000-8000-000000000001"],
      },
      requestId: "req-create",
    });
    expect(countTransactions()).toBe(1);
  });

  it("forbids caching and echoes the correlation identifier", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");
    const response = await createEndpoint()(
      postRequest(validBody(category.id), { requestId: "req-headers" }),
    );

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("req-headers");
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
  });

  it("derives the workspace from the database, not from the request", async () => {
    let seen: string | undefined;
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle(context) {
          seen = context.workspaceId;
          expect(context.workspace.id).toBe(context.workspaceId);
          expect(context.body).toBeUndefined();
          expect(context.query).toBeUndefined();

          return accepted({ status: 200, data: null });
        },
      },
      deps(),
    );

    const response = await handler(buildRequest({ path: "/api/summary" }));

    expect(response.status).toBe(200);
    expect(seen).toBe(fixture.workspaceId);
  });

  it("answers 204 without a body for a mutation with nothing to represent", async () => {
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          return accepted({ status: NO_CONTENT_STATUS, data: null });
        },
      },
      deps(),
    );

    const response = await handler(
      buildRequest({ method: "DELETE", path: "/api/transactions/t-1" }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("");
  });

  it("parses the query string of a read with the strict schema", async () => {
    const handler = createApiHandler<undefined, { limit?: number }, unknown>(
      {
        querySchema: apiObject({
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
        handle(context) {
          return accepted({ status: 200, data: context.query });
        },
      },
      deps(),
    );

    const response = await handler(
      buildRequest({ path: "/api/transactions?limit=25" }),
    );

    await expect(readEnvelope(response)).resolves.toMatchObject({
      data: { limit: 25 },
    });
  });
});

describe("request parsing boundaries", () => {
  it("refuses a wrong content type with 400 before touching storage", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");
    const response = await createEndpoint()(
      postRequest(validBody(category.id), { contentType: "text/plain" }),
    );

    expect(response.status).toBe(400);
    expect(countTransactions()).toBe(0);
  });

  it("refuses malformed JSON with 400", async () => {
    const response = await createEndpoint()(postRequest('{"amountMinor":'));

    expect(response.status).toBe(400);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      error: { code: "badRequest" },
    });
  });

  it("refuses an oversized body with 413", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");
    const oversized = {
      ...validBody(category.id),
      note: "a".repeat(MAX_REQUEST_BODY_BYTES),
    };
    const response = await createEndpoint()(postRequest(oversized));

    expect(response.status).toBe(413);
    expect(countTransactions()).toBe(0);
  });

  it("refuses an unknown property with 422 and names it", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");
    const response = await createEndpoint()(
      postRequest({ ...validBody(category.id), isAdmin: true }),
    );

    expect(response.status).toBe(422);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      error: {
        code: "validationFailed",
        details: [{ field: "isAdmin", code: "unknownField" }],
      },
    });
    expect(countTransactions()).toBe(0);
  });

  it("never accepts a workspace identifier from the body", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");
    const response = await createEndpoint()(
      postRequest({ ...validBody(category.id), workspaceId: "other" }),
    );

    expect(response.status).toBe(422);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      error: { details: [{ field: "workspaceId", code: "unknownField" }] },
    });
    expect(countTransactions()).toBe(0);
  });

  it("never accepts a workspace identifier from the query string", async () => {
    const handler = createApiHandler<undefined, unknown, unknown>(
      {
        querySchema: apiObject({}),
        handle(context) {
          return accepted({ status: 200, data: context.query });
        },
      },
      deps(),
    );

    const response = await handler(
      buildRequest({ path: "/api/transactions?workspaceId=other" }),
    );

    expect(response.status).toBe(422);
  });

  it("refuses a query string before it reads the body", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");
    const handler = createApiHandler<CreateBody, unknown, unknown>(
      {
        querySchema: apiObject({}),
        bodySchema: createBodySchema,
        handle() {
          throw new Error("The endpoint must not run");
        },
      },
      deps(),
    );
    const request = postRequest(validBody(category.id), {
      path: "/api/transactions?unknown=1",
    });
    const response = await handler(request);

    expect(response.status).toBe(422);
    expect(request.bodyUsed).toBe(false);
  });
});

describe("origin policy", () => {
  it("refuses a mutation without Origin with 403 and never reads the body", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");
    const request = postRequest(validBody(category.id), { origin: null });
    const response = await createEndpoint()(request);

    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expect(countTransactions()).toBe(0);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("refuses a mutation from a foreign origin with 403", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");
    const response = await createEndpoint()(
      postRequest(validBody(category.id), { origin: "http://evil.example" }),
    );

    expect(response.status).toBe(403);
    expect(countTransactions()).toBe(0);
  });

  it("lets a read from a foreign origin through", async () => {
    const handler = createApiHandler<undefined, undefined, string>(
      {
        handle() {
          return accepted({ status: 200, data: "ok" });
        },
      },
      deps(),
    );

    const response = await handler(
      buildRequest({ origin: "http://evil.example" }),
    );

    expect(response.status).toBe(200);
  });
});

describe("domain refusals", () => {
  it("maps a future civil date to 422 with the domain reason", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");
    const response = await createEndpoint()(
      postRequest({ ...validBody(category.id), date: "2026-09-07" }),
    );

    expect(response.status).toBe(422);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      error: { details: [{ field: "date", code: "futureDate" }] },
    });
    expect(countTransactions()).toBe(0);
  });

  it("maps an unknown category to 404", async () => {
    const response = await createEndpoint()(
      postRequest(validBody("00000000-0000-4000-8000-0000000000ff")),
    );

    expect(response.status).toBe(404);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      error: {
        code: "notFound",
        details: [{ field: "categoryId", code: "notFound" }],
      },
    });
  });

  it("maps an archived category to 409", async () => {
    const category = storeCategory(fixture, "Antigua", "expense", NOW);
    const response = await createEndpoint()(
      postRequest(validBody(category.id)),
    );

    expect(response.status).toBe(409);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      error: {
        code: "conflict",
        details: [{ field: "categoryId", code: "archived" }],
      },
    });
  });

  it("maps a mismatched category type to 422", async () => {
    const category = storeCategory(fixture, "Nómina", "income");
    const response = await createEndpoint()(
      postRequest(validBody(category.id)),
    );

    expect(response.status).toBe(422);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      error: { details: [{ field: "type", code: "incompatibleCategoryType" }] },
    });
  });

  it("maps a unit that cannot roll back to 503 without details", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");
    const handler = createApiHandler<CreateBody, undefined, null>(
      {
        bodySchema: createBodySchema,
        handle(context): ApiResult<ApiSuccess<null>> {
          const useCase = createCreateTransaction({
            transactions: sqliteTransactionRepository,
            categories: sqliteCategoryRepository,
            tags: sqliteTagRepository,
            clock: new FixedClock(TODAY),
            createId,
            now: () => NOW,
          });
          const unit: SqliteUnitOfWork = autocommitUnitOfWork(
            context.connection,
          );
          const result = useCase.execute(unit, {
            workspaceId: context.workspaceId,
            ...context.body,
            concept: null,
            note: null,
          });

          if (!result.ok) {
            return refused(toApiFailure(result.errors));
          }

          return accepted({ status: 201, data: null });
        },
      },
      deps(),
    );

    const response = await handler(postRequest(validBody(category.id)));

    expect(response.status).toBe(503);
    await expect(readEnvelope(response)).resolves.toEqual({
      error: {
        code: "serviceUnavailable",
        message: "El servicio no está disponible en este momento.",
        requestId: expect.any(String),
      },
    });
  });
});

describe("infrastructure failures", () => {
  it("answers 503 when the process configuration is unusable", async () => {
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          throw new Error("The endpoint must not run");
        },
      },
      deps({ env: { TZ: "Europe/Madrid" } }),
    );

    const response = await handler(buildRequest());

    expect(response.status).toBe(503);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      error: { code: "serviceUnavailable" },
    });
  });

  it("answers 503 when the database file cannot be opened", async () => {
    const file = createTemporarySqliteFile();
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          throw new Error("The endpoint must not run");
        },
      },
      deps({ env: createValidAppEnv(file.directory, { APP_URL: APP_ORIGIN }) }),
    );

    try {
      const response = await handler(buildRequest());

      expect(response.status).toBe(503);
    } finally {
      file.cleanup();
    }
  });

  it("answers 503 when the personal workspace has not been bootstrapped", async () => {
    fixture.connection.sqlite.prepare("DELETE FROM preference").run();
    fixture.connection.sqlite.prepare("DELETE FROM workspace").run();

    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          throw new Error("The endpoint must not run");
        },
      },
      deps({ openConnection: () => ({ ok: true, value: fixture.connection }) }),
    );

    const response = await handler(buildRequest());

    expect(response.status).toBe(503);
    await expect(readEnvelope(response)).resolves.toMatchObject({
      error: { code: "serviceUnavailable" },
    });
  });

  it("answers 500 when the endpoint throws unexpectedly", async () => {
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          throw new TypeError("note = 'Alquiler de marzo'");
        },
      },
      deps(),
    );

    const response = await handler(buildRequest({ path: "/api/summary" }));

    expect(response.status).toBe(500);
    await expect(readEnvelope(response)).resolves.toEqual({
      error: {
        code: "internalError",
        message: "Se ha producido un error inesperado.",
        requestId: expect.any(String),
      },
    });
  });

  it("answers 500 when the endpoint rejects asynchronously", async () => {
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          return Promise.reject(new RangeError("1250"));
        },
      },
      deps(),
    );

    expect((await handler(buildRequest())).status).toBe(500);
    expect(logs.entries[0].failureType).toBe("RangeError");
  });
});

describe("sanitized logging", () => {
  it("records one entry per request with only the accepted fields", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");

    await createEndpoint()(
      postRequest(validBody(category.id), { requestId: "req-log" }),
    );

    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]).toEqual({
      requestId: "req-log",
      method: "POST",
      route: "/api/transactions",
      status: 201,
      durationMs: 0,
    });
  });

  it("records a refusal by code and count, never by value", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");

    await createEndpoint()(
      postRequest({ ...validBody(category.id), date: "2026-09-07" }),
    );

    expect(logs.entries[0]).toEqual({
      requestId: expect.any(String),
      method: "POST",
      route: "/api/transactions",
      status: 422,
      durationMs: 0,
      errorCode: "validationFailed",
      fieldErrorCount: 1,
    });
  });

  it("keeps the concept, the note and the tags out of the log entry", async () => {
    const category = storeCategory(fixture, "Alimentación", "expense");

    await createEndpoint()(postRequest(validBody(category.id)));

    const serialised = JSON.stringify(logs.entries);

    expect(serialised).not.toContain("Compra semanal");
    expect(serialised).not.toContain("Detalle privado");
    expect(serialised).not.toContain("hogar");
    expect(serialised).not.toContain("1250");
  });

  it("keeps the search text of a read out of the recorded route", async () => {
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          return accepted({ status: 200, data: null });
        },
      },
      deps(),
    );

    await handler(
      buildRequest({ path: "/api/transactions?q=alquiler%20de%20marzo" }),
    );

    expect(logs.entries[0].route).toBe("/api/transactions");
    expect(JSON.stringify(logs.entries)).not.toContain("alquiler");
  });

  it("records the class of an unexpected throw, never its message", async () => {
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          throw new TypeError("note = 'Alquiler de marzo'");
        },
      },
      deps(),
    );

    await handler(buildRequest());

    expect(logs.entries[0]).toMatchObject({
      status: 500,
      errorCode: "internalError",
      failureType: "TypeError",
    });
    expect(JSON.stringify(logs.entries)).not.toContain("Alquiler");
  });

  it("measures the elapsed time of the request", async () => {
    let clock = 1_000;
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          return accepted({ status: 200, data: null });
        },
      },
      deps({
        now: () => {
          clock += 5;
          return clock;
        },
      }),
    );

    await handler(buildRequest());

    expect(logs.entries[0].durationMs).toBe(5);
  });

  it("replaces an unsafe client identifier before it reaches the log", async () => {
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          return accepted({ status: 200, data: null });
        },
      },
      deps({ createRequestId: () => "generated" }),
    );

    await handler(buildRequest({ requestId: "not safe at all" }));

    expect(logs.entries[0].requestId).toBe("generated");
  });
});

describe("default collaborators", () => {
  it("falls back to the generated identifier and the failure envelope", async () => {
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          return accepted({ status: 200, data: null });
        },
      },
      { env: { TZ: "Europe/Madrid" }, logger: logs.logger },
    );

    const response = await handler(buildRequest());
    const envelope = (await readEnvelope(response)) as {
      error: { requestId: string };
    };

    expect(response.status).toBe(503);
    expect(envelope.error.requestId).toMatch(/^[A-Za-z0-9-]{36}$/u);
    expect(logs.entries[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reads the process environment and writes to the console by default", async () => {
    vi.stubEnv("DATABASE_PATH", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const handler = createApiHandler<undefined, undefined, null>({
      handle() {
        throw new Error("The endpoint must not run");
      },
    });

    const response = await handler(buildRequest({ path: "/api/summary" }));

    expect(response.status).toBe(503);
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(info.mock.calls[0][0] as string)).toMatchObject({
      event: "api_request",
      method: "GET",
      route: "/api/summary",
      status: 503,
      errorCode: "serviceUnavailable",
    });
  });

  it("reports a refusal that carries no details with a zero count", async () => {
    const handler = createApiHandler<undefined, undefined, null>(
      {
        handle() {
          return refused(apiFailure("notFound"));
        },
      },
      deps(),
    );

    expect((await handler(buildRequest())).status).toBe(404);
    expect(logs.entries[0].fieldErrorCount).toBe(0);
  });
});
