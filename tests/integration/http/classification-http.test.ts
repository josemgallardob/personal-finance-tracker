/**
 * Classification HTTP helpers and route wiring.
 *
 * Path identifiers, repository refusals and the documented Node runtime of
 * every classification route are checked here. The collection handlers are
 * exercised with a real SQLite file in the sibling endpoint tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as categoriesCollection from "../../../src/app/api/categories/route";
import * as categoriesOrder from "../../../src/app/api/categories/order/route";
import * as categoryItem from "../../../src/app/api/categories/[id]/route";
import * as categoryArchive from "../../../src/app/api/categories/[id]/archive/route";
import * as tagsCollection from "../../../src/app/api/tags/route";
import * as tagItem from "../../../src/app/api/tags/[id]/route";
import * as tagArchive from "../../../src/app/api/tags/[id]/archive/route";
import {
  API_DYNAMIC,
  API_REVALIDATE,
  API_RUNTIME,
} from "../../../src/shared/server/http";
import {
  failed,
  type ClassificationRepositoryErrorCode,
} from "../../../src/modules/classification/application/ports/classification-repository";
import {
  categoryIdFrom,
  fromClassification,
  runDomainInTransaction,
  tagIdFrom,
  toDomainError,
} from "../../../src/modules/classification/server/http";
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

describe("classification path identifiers", () => {
  it("reads a category or tag identifier and refuses the order segment", () => {
    expect(
      categoryIdFrom(new URL(`${"http://localhost:3000"}/api/categories/abc`)),
    ).toEqual({
      ok: true,
      value: "abc",
    });
    expect(
      categoryIdFrom(
        new URL("http://localhost:3000/api/categories/abc/archive"),
      ),
    ).toEqual({ ok: true, value: "abc" });
    expect(
      categoryIdFrom(new URL("http://localhost:3000/api/categories/order")),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "notFound" }),
    });
    expect(tagIdFrom(new URL("http://localhost:3000/api/tags/home"))).toEqual({
      ok: true,
      value: "home",
    });
    expect(
      tagIdFrom(new URL("http://localhost:3000/api/categories/abc")),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "notFound" }),
    });
    expect(
      categoryIdFrom(new URL("http://localhost:3000/api/categories/abc/extra")),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "notFound" }),
    });
  });
});

describe("classification refusal mapping", () => {
  it("maps every repository refusal to a named domain error", () => {
    const error = (code: ClassificationRepositoryErrorCode) => ({ code });

    expect(toDomainError(error("duplicateName"), "name")).toEqual({
      field: "name",
      code: "duplicateName",
    });
    expect(toDomainError(error("duplicateId"), "name")).toEqual({
      field: "id",
      code: "invalidIdentifier",
    });
    expect(toDomainError(error("categoryNotFound"), "name")).toEqual({
      field: "categoryId",
      code: "notFound",
    });
    expect(toDomainError(error("tagNotFound"), "name")).toEqual({
      field: "tagId",
      code: "notFound",
    });
    expect(toDomainError(error("alreadyArchived"), "tagId")).toEqual({
      field: "tagId",
      code: "alreadyArchived",
    });
    expect(toDomainError(error("invalidCategoryOrder"), "name")).toEqual({
      field: "orderedCategoryIds",
      code: "invalidSortOrder",
    });
    expect(toDomainError(error("transactionRequired"), "name")).toEqual({
      field: "orderedCategoryIds",
      code: "invalidSortOrder",
    });
    expect(toDomainError(error("unknownWorkspace"), "name")).toEqual({
      field: "workspaceId",
      code: "notFound",
    });
    expect(toDomainError(error("invalidStoredRow"), "name")).toEqual({
      field: "storage",
      code: "unavailable",
    });
    expect(toDomainError(error("storageFailure"), "name")).toEqual({
      field: "storage",
      code: "unavailable",
    });
  });

  it("accepts a stored classification result", () => {
    expect(fromClassification({ ok: true, value: ["row"] }, "name")).toEqual({
      ok: true,
      value: ["row"],
    });
    expect(
      fromClassification(failed("categoryNotFound"), "name"),
    ).toMatchObject({
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

  it("commits an accepted domain result", () => {
    expect(
      runDomainInTransaction(fixture.connection, () => valid("ok")),
    ).toEqual({ ok: true, value: "ok" });
  });
});

describe("classification route modules", () => {
  it("declare the Node runtime and refuse an unconfigured process", async () => {
    const file = createTemporarySqliteFile();
    const env = createValidAppEnv(file.filePath);
    vi.stubEnv("DATABASE_PATH", env.DATABASE_PATH ?? "");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("TZ", env.TZ ?? "");

    expect(categoriesCollection.runtime).toBe(API_RUNTIME);
    expect(categoriesCollection.dynamic).toBe(API_DYNAMIC);
    expect(categoriesCollection.revalidate).toBe(API_REVALIDATE);
    expect(categoriesOrder.runtime).toBe(API_RUNTIME);
    expect(categoryItem.runtime).toBe(API_RUNTIME);
    expect(categoryArchive.runtime).toBe(API_RUNTIME);
    expect(tagsCollection.runtime).toBe(API_RUNTIME);
    expect(tagItem.runtime).toBe(API_RUNTIME);
    expect(tagArchive.runtime).toBe(API_RUNTIME);

    const list = await categoriesCollection.GET(
      buildRequest({ path: "/api/categories" }),
    );
    const create = await categoriesCollection.POST(
      buildRequest({
        method: "POST",
        path: "/api/categories",
        body: JSON.stringify({ name: "Casa", type: "expense" }),
      }),
    );
    const order = await categoriesOrder.PUT(
      buildRequest({
        method: "PUT",
        path: "/api/categories/order",
        body: JSON.stringify({ type: "expense", orderedCategoryIds: [] }),
      }),
    );
    const rename = await categoryItem.PATCH(
      buildRequest({
        method: "PATCH",
        path: "/api/categories/id-1",
        body: JSON.stringify({ name: "Casa" }),
      }),
    );
    const archive = await categoryArchive.POST(
      buildRequest({
        method: "POST",
        path: "/api/categories/id-1/archive",
        body: JSON.stringify({}),
      }),
    );
    const tags = await tagsCollection.GET(buildRequest({ path: "/api/tags" }));
    const createTag = await tagsCollection.POST(
      buildRequest({
        method: "POST",
        path: "/api/tags",
        body: JSON.stringify({ name: "Viajes" }),
      }),
    );
    const renameTag = await tagItem.PATCH(
      buildRequest({
        method: "PATCH",
        path: "/api/tags/id-1",
        body: JSON.stringify({ name: "Viajes" }),
      }),
    );
    const archiveTag = await tagArchive.POST(
      buildRequest({
        method: "POST",
        path: "/api/tags/id-1/archive",
        body: JSON.stringify({}),
      }),
    );

    expect(list.status).toBe(503);
    expect(create.status).toBe(503);
    expect(order.status).toBe(503);
    expect(rename.status).toBe(503);
    expect(archive.status).toBe(503);
    expect(tags.status).toBe(503);
    expect(createTag.status).toBe(503);
    expect(renameTag.status).toBe(503);
    expect(archiveTag.status).toBe(503);

    file.cleanup();
  });
});
