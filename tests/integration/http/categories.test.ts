/**
 * Category HTTP endpoints against a real, migrated SQLite file.
 *
 * The handlers run the documented GET/POST collection, PATCH rename, POST
 * archive and PUT complete-order contracts through the real maintenance
 * services. Only the process environment, the connection opener and the log
 * sink are injected.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createArchiveCategoryHandler,
  createCreateCategoryHandler,
  createListCategoriesHandler,
  createRenameCategoryHandler,
  createReorderCategoriesHandler,
} from "../../../src/modules/classification/server/category-http";
import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import { autocommitUnitOfWork } from "../../../src/modules/classification/infrastructure/sqlite-unit-of-work";
import type { CategoryId } from "../../../src/modules/classification/domain/category";
import type { ApiHandlerDeps } from "../../../src/shared/server/http/handler";
import {
  buildRequest,
  createHttpFixture,
  createLogCollector,
  openConnectionFrom,
  readEnvelope,
  storeCategory,
  type HttpFixture,
} from "./helpers";

const NOW = 1_746_268_800_000;
const FOREIGN_ID = "foreign-category-id";

let fixture: HttpFixture;
let logs: ReturnType<typeof createLogCollector>;

beforeEach(() => {
  fixture = createHttpFixture();
  logs = createLogCollector();
});

afterEach(() => {
  fixture.cleanup();
});

function deps(): ApiHandlerDeps {
  return {
    env: fixture.env,
    openConnection: openConnectionFrom,
    logger: logs.logger,
    now: () => NOW,
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

describe("GET /api/categories", () => {
  it("lists active categories by default and hides storage fields", async () => {
    const alimentacion = storeCategory(fixture, "Alimentación", "expense");
    const sueldo = storeCategory(fixture, "Sueldo", "income");
    storeCategory(fixture, "Archivada", "expense");
    fixture.connection.sqlite
      .prepare("UPDATE category SET archived_at = ? WHERE name = ?")
      .run(NOW, "Archivada");

    const response = await createListCategoriesHandler(deps())(
      buildRequest({
        path: "/api/categories",
        method: "GET",
        requestId: "req-list",
      }),
    );
    const payload = await parse(response);

    expect(payload.status).toBe(200);
    expect(payload.body).toEqual({
      data: [
        {
          id: alimentacion.id,
          name: "Alimentación",
          type: "expense",
          isArchived: false,
        },
        {
          id: sueldo.id,
          name: "Sueldo",
          type: "income",
          isArchived: false,
        },
      ],
      requestId: "req-list",
    });
    expect(JSON.stringify(payload.body)).not.toContain("workspace");
    expect(JSON.stringify(payload.body)).not.toContain("archivedAt");
    expect(JSON.stringify(payload.body)).not.toContain("normalizedName");
  });

  it("filters by status and type", async () => {
    storeCategory(fixture, "Casa", "expense");
    const ocio = storeCategory(fixture, "Ocio", "expense");
    storeCategory(fixture, "Sueldo", "income");
    fixture.connection.sqlite
      .prepare("UPDATE category SET archived_at = ? WHERE name = ?")
      .run(NOW, "Ocio");

    const archived = await parse(
      await createListCategoriesHandler(deps())(
        buildRequest({
          path: "/api/categories?status=archived&type=expense",
          method: "GET",
        }),
      ),
    );
    const income = await parse(
      await createListCategoriesHandler(deps())(
        buildRequest({ path: "/api/categories?status=active&type=income" }),
      ),
    );
    const all = await parse(
      await createListCategoriesHandler(deps())(
        buildRequest({ path: "/api/categories?status=all&type=expense" }),
      ),
    );

    expect(archived.body).toMatchObject({
      data: [{ id: ocio.id, name: "Ocio", isArchived: true }],
    });
    expect(
      (income.body as { data: { name: string }[] }).data.map((row) => row.name),
    ).toEqual(["Sueldo"]);
    expect(
      (all.body as { data: { name: string; isArchived: boolean }[] }).data,
    ).toEqual([
      {
        id: expect.any(String),
        name: "Casa",
        type: "expense",
        isArchived: false,
      },
      { id: ocio.id, name: "Ocio", type: "expense", isArchived: true },
    ]);
  });

  it("refuses an unknown filter, a repeated type and a client workspace", async () => {
    const unknown = await parse(
      await createListCategoriesHandler(deps())(
        buildRequest({ path: "/api/categories?foo=1" }),
      ),
    );
    const repeated = await parse(
      await createListCategoriesHandler(deps())(
        buildRequest({ path: "/api/categories?type=expense&type=income" }),
      ),
    );
    const workspace = await parse(
      await createListCategoriesHandler(deps())(
        buildRequest({
          path: `/api/categories?workspaceId=${fixture.workspaceId}`,
        }),
      ),
    );

    const invalidType = await parse(
      await createListCategoriesHandler(deps())(
        buildRequest({ path: "/api/categories?type=gasto" }),
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
    expect(invalidType.status).toBe(422);
    expect(repeated.status).toBe(422);
    expect(workspace).toMatchObject({
      status: 422,
      body: {
        error: {
          code: "validationFailed",
          details: [{ field: "workspaceId", code: "unknownField" }],
        },
      },
    });
  });
});

describe("POST /api/categories", () => {
  it("creates a category, normalizes its name and answers 201", async () => {
    const response = await createCreateCategoryHandler(deps())(
      jsonRequest(
        "POST",
        "/api/categories",
        { name: "  Café  ", type: "expense" },
        "req-create",
      ),
    );
    const payload = await parse(response);

    expect(payload.status).toBe(201);
    expect(payload.body).toEqual({
      data: {
        id: expect.stringMatching(/^[A-Za-z0-9_-]{1,64}$/),
        name: "Café",
        type: "expense",
        isArchived: false,
      },
      requestId: "req-create",
    });
  });

  it("conflicts on a normalized duplicate name of the same type", async () => {
    storeCategory(fixture, "Casa", "expense");

    const response = await parse(
      await createCreateCategoryHandler(deps())(
        jsonRequest("POST", "/api/categories", {
          name: "  casa  ",
          type: "expense",
        }),
      ),
    );

    expect(response).toMatchObject({
      status: 409,
      body: {
        error: {
          code: "conflict",
          details: [{ field: "name", code: "duplicateName" }],
        },
      },
    });
  });

  it("allows the same name in the other type and refuses a type change key", async () => {
    storeCategory(fixture, "Regalos", "expense");

    const created = await parse(
      await createCreateCategoryHandler(deps())(
        jsonRequest("POST", "/api/categories", {
          name: "Regalos",
          type: "income",
        }),
      ),
    );
    const unknown = await parse(
      await createCreateCategoryHandler(deps())(
        jsonRequest("POST", "/api/categories", {
          name: "Extra",
          type: "expense",
          sortOrder: 0,
        }),
      ),
    );

    expect(created.status).toBe(201);
    expect(unknown).toMatchObject({
      status: 422,
      body: {
        error: {
          details: [{ field: "sortOrder", code: "unknownField" }],
        },
      },
    });
  });

  it("refuses a foreign origin", async () => {
    const response = await createCreateCategoryHandler(deps())(
      buildRequest({
        method: "POST",
        path: "/api/categories",
        origin: "https://evil.example",
        body: JSON.stringify({ name: "Casa", type: "expense" }),
      }),
    );

    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/categories/[id]", () => {
  it("renames without changing the type", async () => {
    const category = storeCategory(fixture, "Casa", "expense");

    const response = await parse(
      await createRenameCategoryHandler(deps())(
        jsonRequest("PATCH", `/api/categories/${category.id}`, {
          name: "Hogar",
        }),
      ),
    );

    expect(response).toMatchObject({
      status: 200,
      body: {
        data: {
          id: category.id,
          name: "Hogar",
          type: "expense",
          isArchived: false,
        },
      },
    });
  });

  it("refuses a type field, a missing category and a foreign identifier", async () => {
    const category = storeCategory(fixture, "Casa", "expense");

    const typeChange = await parse(
      await createRenameCategoryHandler(deps())(
        jsonRequest("PATCH", `/api/categories/${category.id}`, {
          name: "Hogar",
          type: "income",
        }),
      ),
    );
    const missing = await parse(
      await createRenameCategoryHandler(deps())(
        jsonRequest("PATCH", `/api/categories/${FOREIGN_ID}`, {
          name: "Hogar",
        }),
      ),
    );

    expect(typeChange).toMatchObject({
      status: 422,
      body: {
        error: { details: [{ field: "type", code: "unknownField" }] },
      },
    });
    expect(missing).toMatchObject({
      status: 404,
      body: {
        error: {
          code: "notFound",
          details: [{ field: "categoryId", code: "notFound" }],
        },
      },
    });
  });
});

describe("POST /api/categories/[id]/archive", () => {
  it("archives a category and keeps it readable in the historical list", async () => {
    const category = storeCategory(fixture, "Ocio", "expense");

    const archived = await parse(
      await createArchiveCategoryHandler(deps())(
        jsonRequest("POST", `/api/categories/${category.id}/archive`, {}),
      ),
    );
    const historical = await parse(
      await createListCategoriesHandler(deps())(
        buildRequest({ path: "/api/categories?status=all" }),
      ),
    );
    const active = await parse(
      await createListCategoriesHandler(deps())(
        buildRequest({ path: "/api/categories?status=active" }),
      ),
    );

    expect(archived).toMatchObject({
      status: 200,
      body: { data: { id: category.id, name: "Ocio", isArchived: true } },
    });
    expect(
      (historical.body as { data: { isArchived: boolean }[] }).data,
    ).toEqual([
      { id: category.id, name: "Ocio", type: "expense", isArchived: true },
    ]);
    expect((active.body as { data: unknown[] }).data).toEqual([]);
  });

  it("conflicts when the category is already archived", async () => {
    const category = storeCategory(fixture, "Ocio", "expense");
    await createArchiveCategoryHandler(deps())(
      jsonRequest("POST", `/api/categories/${category.id}/archive`, {}),
    );

    const second = await parse(
      await createArchiveCategoryHandler(deps())(
        jsonRequest("POST", `/api/categories/${category.id}/archive`, {}),
      ),
    );

    expect(second).toMatchObject({
      status: 409,
      body: {
        error: {
          code: "conflict",
          details: [{ field: "categoryId", code: "alreadyArchived" }],
        },
      },
    });
  });
});

describe("PUT /api/categories/order", () => {
  it("applies a complete duplicate-free order of one type", async () => {
    const first = await created("Casa", "expense");
    const second = await created("Ocio", "expense");
    await created("Sueldo", "income");

    const response = await parse(
      await createReorderCategoriesHandler(deps())(
        jsonRequest("PUT", "/api/categories/order", {
          type: "expense",
          orderedCategoryIds: [second.id, first.id],
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(
      (response.body as { data: { id: string }[] }).data.map((row) => row.id),
    ).toEqual([second.id, first.id]);
  });

  it("refuses an incomplete, duplicated or foreign list and rolls the order back", async () => {
    const first = await created("Casa", "expense");
    const second = await created("Ocio", "expense");
    const income = await created("Sueldo", "income");

    const incomplete = await parse(
      await createReorderCategoriesHandler(deps())(
        jsonRequest("PUT", "/api/categories/order", {
          type: "expense",
          orderedCategoryIds: [second.id],
        }),
      ),
    );
    const duplicated = await parse(
      await createReorderCategoriesHandler(deps())(
        jsonRequest("PUT", "/api/categories/order", {
          type: "expense",
          orderedCategoryIds: [first.id, first.id],
        }),
      ),
    );
    const foreign = await parse(
      await createReorderCategoriesHandler(deps())(
        jsonRequest("PUT", "/api/categories/order", {
          type: "expense",
          orderedCategoryIds: [first.id, second.id, income.id],
        }),
      ),
    );

    expect(incomplete).toMatchObject({
      status: 422,
      body: {
        error: {
          code: "validationFailed",
          details: [{ field: "orderedCategoryIds", code: "invalidSortOrder" }],
        },
      },
    });
    expect(duplicated.status).toBe(422);
    expect(foreign.status).toBe(422);

    const stored = sqliteCategoryRepository.findCategoryById(
      autocommitUnitOfWork(fixture.connection),
      { workspaceId: fixture.workspaceId, categoryId: first.id as CategoryId },
    );

    expect(stored).toMatchObject({
      ok: true,
      value: { id: first.id, sortOrder: 0 },
    });
  });
});

describe("category path isolation", () => {
  it("does not treat the order segment as a category identifier", async () => {
    const response = await parse(
      await createRenameCategoryHandler(deps())(
        jsonRequest("PATCH", "/api/categories/order", { name: "Hogar" }),
      ),
    );

    expect(response.status).toBe(404);
  });

  it("refuses an archive request whose path has no category identifier", async () => {
    const response = await parse(
      await createArchiveCategoryHandler(deps())(
        jsonRequest("POST", "/api/categories", {}),
      ),
    );

    expect(response.status).toBe(404);
  });

  it("answers a service failure when a stored category is unreadable", async () => {
    const category = storeCategory(fixture, "Casa", "expense");
    fixture.connection.sqlite
      .prepare("UPDATE category SET name = ?, normalized_name = ? WHERE id = ?")
      .run("a".repeat(81), "a".repeat(81), category.id);

    const response = await parse(
      await createListCategoriesHandler(deps())(
        buildRequest({ path: "/api/categories" }),
      ),
    );

    expect(response.status).toBe(503);
  });
});

async function created(name: string, type: "expense" | "income") {
  const payload = await parse(
    await createCreateCategoryHandler(deps())(
      jsonRequest("POST", "/api/categories", { name, type }),
    ),
  );

  return (payload.body as { data: { id: string } }).data;
}
