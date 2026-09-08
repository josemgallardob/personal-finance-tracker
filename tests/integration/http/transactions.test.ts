/**
 * Transaction HTTP endpoints against a real, migrated SQLite file.
 *
 * The handlers run GET/POST collection and GET/PUT/DELETE item contracts
 * through the real create, update, delete and list services. Only the process
 * environment, the connection opener, the clock and the log sink are injected.
 * There is no duplication endpoint: a copy is GET followed by POST.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createCreateTransactionHandler,
  createDeleteTransactionHandler,
  createGetTransactionHandler,
  createListTransactionsHandler,
  createUpdateTransactionHandler,
  type TransactionHttpDeps,
} from "../../../src/modules/transactions/server/transaction-http";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate } from "../../../src/shared/domain/dates";
import {
  buildRequest,
  createHttpFixture,
  createLogCollector,
  openConnectionFrom,
  readEnvelope,
  storeCategory,
  storeTag,
  storeTransaction,
  type HttpFixture,
} from "./helpers";

const TODAY = "2026-09-06" as LocalDate;
const NOW = 1_746_268_800_000;
const MISSING_ID = "missing-transaction-id";

let fixture: HttpFixture;
let logs: ReturnType<typeof createLogCollector>;

beforeEach(() => {
  fixture = createHttpFixture();
  logs = createLogCollector();
});

afterEach(() => {
  fixture.cleanup();
});

function deps(): TransactionHttpDeps {
  return {
    env: fixture.env,
    openConnection: openConnectionFrom,
    logger: logs.logger,
    now: () => NOW,
    clock: new FixedClock(TODAY),
  };
}

function jsonRequest(
  method: string,
  path: string,
  body: unknown,
  requestId?: string,
): Request {
  return buildRequest({
    method,
    path,
    body: JSON.stringify(body),
    requestId,
  });
}

async function parse(response: Response) {
  return {
    status: response.status,
    body: await readEnvelope(response),
  };
}

function writeBody(
  categoryId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "expense",
    amountMinor: 1_250,
    date: TODAY,
    categoryId,
    ...extra,
  };
}

describe("GET /api/transactions", () => {
  it("returns an empty cursor page and hides storage fields", async () => {
    const payload = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({ path: "/api/transactions", requestId: "req-list" }),
      ),
    );

    expect(payload).toEqual({
      status: 200,
      body: {
        data: { items: [], nextCursor: null },
        requestId: "req-list",
      },
    });
    expect(JSON.stringify(payload.body)).not.toContain("workspace");
    expect(JSON.stringify(payload.body)).not.toContain("createdAt");
  });

  it("pages with an opaque cursor and applies every documented filter", async () => {
    const comida = storeCategory(fixture, "Comida", "expense");
    const sueldo = storeCategory(fixture, "Sueldo", "income");
    const hogar = storeTag(fixture, "Hogar");
    const ocio = storeTag(fixture, "Ocio");
    const first = storeTransaction(fixture, {
      category: comida,
      date: "2026-09-06",
      amountMinor: 300,
      concept: "Pan",
      createdAt: 300,
      tagIds: [hogar.id],
    });
    const second = storeTransaction(fixture, {
      category: comida,
      date: "2026-09-05",
      amountMinor: 200,
      concept: "Leche",
      createdAt: 200,
      tagIds: [ocio.id],
    });
    storeTransaction(fixture, {
      category: sueldo,
      date: "2026-09-04",
      amountMinor: 100_000,
      concept: "Nómina",
      createdAt: 100,
    });

    const page = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({
          path: `/api/transactions?type=expense&dateFrom=2026-09-05&dateTo=2026-09-06&categoryId=${comida.id}&limit=1`,
        }),
      ),
    );
    const nextCursor = (page.body as { data: { nextCursor: string | null } })
      .data.nextCursor;
    const continued = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({
          path: `/api/transactions?type=expense&dateFrom=2026-09-05&dateTo=2026-09-06&categoryId=${comida.id}&limit=1&cursor=${encodeURIComponent(nextCursor ?? "")}`,
        }),
      ),
    );
    const tagged = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({
          path: `/api/transactions?tagId=${hogar.id}&tagId=${ocio.id}`,
        }),
      ),
    );
    const search = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({ path: "/api/transactions?q=Nómina" }),
      ),
    );
    const untagged = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({ path: "/api/transactions?untagged=true" }),
      ),
    );
    const taggedIncluded = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({ path: "/api/transactions?untagged=false" }),
      ),
    );

    expect(page.status).toBe(200);
    expect(
      (page.body as { data: { items: { id: string }[] } }).data.items,
    ).toEqual([expect.objectContaining({ id: first.id, amountMinor: 300 })]);
    expect(typeof nextCursor).toBe("string");
    expect(nextCursor).not.toContain("{");
    expect(
      (
        continued.body as {
          data: { items: { id: string }[]; nextCursor: null };
        }
      ).data,
    ).toEqual({
      items: [expect.objectContaining({ id: second.id })],
      nextCursor: null,
    });
    expect(
      (tagged.body as { data: { items: { id: string }[] } }).data.items.map(
        (item) => item.id,
      ),
    ).toEqual([first.id, second.id]);
    expect(
      (search.body as { data: { items: { concept: string | null }[] } }).data
        .items,
    ).toEqual([expect.objectContaining({ concept: "Nómina" })]);
    expect(
      (untagged.body as { data: { items: { id: string }[] } }).data.items,
    ).toEqual([expect.objectContaining({ concept: "Nómina", tagIds: [] })]);
    expect(
      (taggedIncluded.body as { data: { items: unknown[] } }).data.items,
    ).toHaveLength(3);
  });

  it("refuses unknown, repeated and mutually exclusive filters", async () => {
    const tag = storeTag(fixture, "Hogar");
    const unknown = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({ path: "/api/transactions?foo=1" }),
      ),
    );
    const repeated = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({
          path: "/api/transactions?type=expense&type=income",
        }),
      ),
    );
    const workspace = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({
          path: `/api/transactions?workspaceId=${fixture.workspaceId}`,
        }),
      ),
    );
    const exclusive = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({
          path: `/api/transactions?untagged=true&tagId=${tag.id}`,
        }),
      ),
    );
    const staleCursor = await parse(
      await createListTransactionsHandler(deps())(
        buildRequest({
          path: "/api/transactions?type=expense&cursor=not-a-cursor",
        }),
      ),
    );

    expect(unknown).toMatchObject({
      status: 422,
      body: {
        error: {
          code: "validationFailed",
          details: [{ field: "foo", code: "unknownField" }],
        },
      },
    });
    expect(repeated.status).toBe(422);
    expect(workspace).toMatchObject({
      status: 422,
      body: {
        error: {
          details: [{ field: "workspaceId", code: "unknownField" }],
        },
      },
    });
    expect(exclusive).toMatchObject({
      status: 422,
      body: {
        error: {
          code: "validationFailed",
          details: expect.arrayContaining([
            { field: "tagId", code: "incompatibleFilters" },
            { field: "untagged", code: "incompatibleFilters" },
          ]),
        },
      },
    });
    expect(staleCursor).toMatchObject({
      status: 422,
      body: {
        error: {
          details: [{ field: "cursor", code: "invalidCursor" }],
        },
      },
    });
  });
});

describe("POST /api/transactions", () => {
  it("creates an expense with discriminated tag inputs and returns 201", async () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const existing = storeTag(fixture, "Hogar");

    const created = await parse(
      await createCreateTransactionHandler(deps())(
        jsonRequest(
          "POST",
          "/api/transactions",
          writeBody(category.id, {
            concept: "Pan",
            note: "Compra",
            tagInputs: [{ tagId: existing.id }, { name: "Mercado" }],
          }),
          "req-create",
        ),
      ),
    );

    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      data: {
        id: expect.any(String),
        type: "expense",
        amountMinor: 1_250,
        date: TODAY,
        categoryId: category.id,
        concept: "Pan",
        note: "Compra",
        tagIds: expect.arrayContaining([existing.id]),
      },
      requestId: "req-create",
    });
    expect(JSON.stringify(created.body)).not.toContain("workspace");
    expect(JSON.stringify(created.body)).not.toContain("createdAt");
    expect(
      (created.body as { data: { tagIds: string[] } }).data.tagIds,
    ).toHaveLength(2);

    const incomeCategory = storeCategory(fixture, "Sueldo", "income");
    const income = await parse(
      await createCreateTransactionHandler(deps())(
        jsonRequest("POST", "/api/transactions", {
          type: "income",
          amountMinor: 100_000,
          date: TODAY,
          categoryId: incomeCategory.id,
        }),
      ),
    );
    expect(income).toMatchObject({
      status: 201,
      body: { data: { type: "income", amountMinor: 100_000 } },
    });
  });

  it("refuses unknown fields, both tag input shapes and an archived category", async () => {
    const category = storeCategory(fixture, "Comida", "expense");
    fixture.connection.sqlite
      .prepare("UPDATE category SET archived_at = ? WHERE id = ?")
      .run(NOW, category.id);
    const unknown = await parse(
      await createCreateTransactionHandler(deps())(
        jsonRequest("POST", "/api/transactions", {
          ...writeBody(category.id),
          foo: true,
        }),
      ),
    );
    const workspace = await parse(
      await createCreateTransactionHandler(deps())(
        jsonRequest("POST", "/api/transactions", {
          ...writeBody(category.id),
          workspaceId: fixture.workspaceId,
        }),
      ),
    );
    const mixedTags = await parse(
      await createCreateTransactionHandler(deps())(
        jsonRequest("POST", "/api/transactions", {
          ...writeBody(storeCategory(fixture, "Ocio", "expense").id),
          tagInputs: [{ tagId: "tag-1", name: "Hogar" }],
        }),
      ),
    );
    const archived = await parse(
      await createCreateTransactionHandler(deps())(
        jsonRequest("POST", "/api/transactions", writeBody(category.id)),
      ),
    );
    const future = await parse(
      await createCreateTransactionHandler(deps())(
        jsonRequest(
          "POST",
          "/api/transactions",
          writeBody(storeCategory(fixture, "Casa", "expense").id, {
            date: "2026-09-07",
          }),
        ),
      ),
    );

    expect(unknown).toMatchObject({
      status: 422,
      body: {
        error: {
          details: [{ field: "foo", code: "unknownField" }],
        },
      },
    });
    expect(workspace).toMatchObject({
      status: 422,
      body: {
        error: {
          details: [{ field: "workspaceId", code: "unknownField" }],
        },
      },
    });
    expect(mixedTags.status).toBe(422);
    expect(archived).toMatchObject({
      status: 409,
      body: {
        error: {
          code: "conflict",
          details: [{ field: "categoryId", code: "archived" }],
        },
      },
    });
    expect(future).toMatchObject({
      status: 422,
      body: {
        error: {
          details: [{ field: "date", code: "futureDate" }],
        },
      },
    });
  });
});

describe("GET /api/transactions/[id]", () => {
  it("returns one movement and 404 when it is missing", async () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const stored = storeTransaction(fixture, {
      category,
      concept: "Pan",
    });

    const found = await parse(
      await createGetTransactionHandler(deps())(
        buildRequest({
          path: `/api/transactions/${stored.id}`,
          requestId: "req-get",
        }),
      ),
    );
    const missing = await parse(
      await createGetTransactionHandler(deps())(
        buildRequest({ path: `/api/transactions/${MISSING_ID}` }),
      ),
    );

    expect(found).toEqual({
      status: 200,
      body: {
        data: {
          id: stored.id,
          type: "expense",
          amountMinor: 1_250,
          date: TODAY,
          categoryId: category.id,
          concept: "Pan",
          note: null,
          tagIds: [],
        },
        requestId: "req-get",
      },
    });
    expect(JSON.stringify(found.body)).not.toContain("updatedAt");
    expect(missing).toMatchObject({
      status: 404,
      body: {
        error: {
          code: "notFound",
          details: [{ field: "id", code: "notFound" }],
        },
      },
    });
    const collection = await parse(
      await createGetTransactionHandler(deps())(
        buildRequest({ path: "/api/transactions" }),
      ),
    );
    expect(collection.status).toBe(404);

    const corrupted = storeTransaction(fixture, {
      category,
      concept: "Leche",
    });
    fixture.connection.sqlite
      .prepare(`UPDATE "transaction" SET concept = ? WHERE id = ?`)
      .run("\u0001", corrupted.id);
    const unreadable = await parse(
      await createGetTransactionHandler(deps())(
        buildRequest({ path: `/api/transactions/${corrupted.id}` }),
      ),
    );
    expect(unreadable.status).toBe(503);
    expect(JSON.stringify(unreadable.body)).not.toContain("invalidStoredRow");
    expect(JSON.stringify(unreadable.body)).not.toContain("concept");
  });
});

describe("PUT /api/transactions/[id]", () => {
  it("replaces a movement and keeps an already linked archived category", async () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const other = storeCategory(fixture, "Ocio", "expense");
    const linked = storeTag(fixture, "Hogar");
    const extra = storeTag(fixture, "Navidad");
    const stored = storeTransaction(fixture, {
      category,
      tagIds: [linked.id],
    });
    fixture.connection.sqlite
      .prepare("UPDATE category SET archived_at = ? WHERE id = ?")
      .run(NOW, category.id);
    fixture.connection.sqlite
      .prepare("UPDATE tag SET archived_at = ? WHERE id = ?")
      .run(NOW, extra.id);

    const kept = await parse(
      await createUpdateTransactionHandler(deps())(
        jsonRequest(
          "PUT",
          `/api/transactions/${stored.id}`,
          writeBody(category.id, {
            amountMinor: 2_000,
            tagInputs: [{ tagId: linked.id }],
          }),
        ),
      ),
    );
    const newArchived = await parse(
      await createUpdateTransactionHandler(deps())(
        jsonRequest(
          "PUT",
          `/api/transactions/${stored.id}`,
          writeBody(category.id, {
            tagInputs: [{ tagId: extra.id }],
          }),
        ),
      ),
    );
    const missing = await parse(
      await createUpdateTransactionHandler(deps())(
        jsonRequest(
          "PUT",
          `/api/transactions/${MISSING_ID}`,
          writeBody(other.id),
        ),
      ),
    );

    expect(kept).toMatchObject({
      status: 200,
      body: {
        data: {
          id: stored.id,
          amountMinor: 2_000,
          categoryId: category.id,
          tagIds: [linked.id],
        },
      },
    });
    expect(newArchived).toMatchObject({
      status: 409,
      body: {
        error: {
          details: [{ field: "tagId", code: "archived" }],
        },
      },
    });
    expect(missing).toMatchObject({
      status: 404,
      body: {
        error: {
          details: [{ field: "id", code: "notFound" }],
        },
      },
    });
    const collection = await parse(
      await createUpdateTransactionHandler(deps())(
        jsonRequest("PUT", "/api/transactions", writeBody(other.id)),
      ),
    );
    expect(collection.status).toBe(404);
  });
});

describe("DELETE /api/transactions/[id]", () => {
  it("answers 204 without a body and then reports the movement missing", async () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const stored = storeTransaction(fixture, { category });

    const deleted = await createDeleteTransactionHandler(deps())(
      buildRequest({
        method: "DELETE",
        path: `/api/transactions/${stored.id}`,
        requestId: "req-del",
      }),
    );
    const again = await parse(
      await createGetTransactionHandler(deps())(
        buildRequest({ path: `/api/transactions/${stored.id}` }),
      ),
    );
    const missing = await parse(
      await createDeleteTransactionHandler(deps())(
        buildRequest({
          method: "DELETE",
          path: `/api/transactions/${MISSING_ID}`,
        }),
      ),
    );

    expect(deleted.status).toBe(204);
    expect(deleted.headers.get("x-request-id")).toBe("req-del");
    expect(deleted.headers.get("content-type")).toBeNull();
    await expect(deleted.text()).resolves.toBe("");
    expect(again.status).toBe(404);
    expect(missing).toMatchObject({
      status: 404,
      body: {
        error: {
          details: [{ field: "id", code: "notFound" }],
        },
      },
    });
    const collection = await parse(
      await createDeleteTransactionHandler(deps())(
        buildRequest({ method: "DELETE", path: "/api/transactions" }),
      ),
    );
    expect(collection.status).toBe(404);
  });
});

describe("duplication remains GET plus POST", () => {
  it("copies a movement by reading it and posting a new body", async () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const tag = storeTag(fixture, "Hogar");
    const origin = storeTransaction(fixture, {
      category,
      concept: "Pan",
      note: "Original",
      tagIds: [tag.id],
    });

    const source = await parse(
      await createGetTransactionHandler(deps())(
        buildRequest({ path: `/api/transactions/${origin.id}` }),
      ),
    );
    const dto = (source.body as { data: Record<string, unknown> }).data;
    const copy = await parse(
      await createCreateTransactionHandler(deps())(
        jsonRequest("POST", "/api/transactions", {
          type: dto.type,
          amountMinor: dto.amountMinor,
          date: dto.date,
          categoryId: dto.categoryId,
          concept: dto.concept,
          note: dto.note,
          tagInputs: (dto.tagIds as string[]).map((tagId) => ({ tagId })),
        }),
      ),
    );

    expect(source.status).toBe(200);
    expect(copy.status).toBe(201);
    expect((copy.body as { data: { id: string } }).data.id).not.toBe(origin.id);
    expect(copy.body).toMatchObject({
      data: {
        type: "expense",
        amountMinor: 1_250,
        categoryId: category.id,
        concept: "Pan",
        note: "Original",
        tagIds: [tag.id],
      },
    });
  });
});
