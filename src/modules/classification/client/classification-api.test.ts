/**
 * Classification browser adapters.
 *
 * Fetch is the only collaborator replaced. URLs, methods and bodies are pinned
 * to the documented endpoints, and a payload that is not a category or tag DTO
 * is refused as an invalid response.
 */

import { describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGE } from "../../../shared/contracts/api";
import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { createClassificationApi } from "./classification-api";

const REQUEST_ID = "req-01";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  });
}

function respondWith(response: Response): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(() => Promise.resolve(response.clone()));
}

function apiWith(fetchImpl: FetchLike) {
  return createClassificationApi(createApiClient({ fetch: fetchImpl }));
}

const category = {
  id: "cat-1",
  name: "Casa",
  type: "expense" as const,
  isArchived: false,
};

const tag = { id: "tag-1", name: "Viajes", isArchived: false };

describe("classificationApi categories", () => {
  it("lists categories with GET and optional filters", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: [category], requestId: REQUEST_ID }),
    );

    const listed = await apiWith(fetchImpl).listCategories();
    const filtered = await apiWith(fetchImpl).listCategories({
      status: "archived",
      type: "expense",
    });

    expect(listed).toMatchObject({ ok: true, data: [category] });
    expect(filtered).toMatchObject({ ok: true });
    expect(fetchImpl.mock.calls[0]).toEqual([
      "/api/categories",
      expect.objectContaining({ method: "GET" }),
    ]);
    expect(fetchImpl.mock.calls[1][0]).toBe(
      "/api/categories?status=archived&type=expense",
    );
    expect(fetchImpl.mock.calls[1][1].method).toBe("GET");
    expect(fetchImpl.mock.calls[1][1].body).toBeUndefined();
  });

  it("creates a category with POST and returns the 201 representation", async () => {
    const fetchImpl = respondWith(
      jsonResponse(201, { data: category, requestId: REQUEST_ID }),
    );

    const result = await apiWith(fetchImpl).createCategory({
      name: "Café",
      type: "expense",
    });

    expect(result).toMatchObject({ ok: true, status: 201, data: category });
    expect(fetchImpl).toHaveBeenCalledWith("/api/categories", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: undefined,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: '{"name":"Café","type":"expense"}',
    });
  });

  it("renames a category with PATCH", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, {
        data: { ...category, name: "Hogar" },
        requestId: REQUEST_ID,
      }),
    );

    const result = await apiWith(fetchImpl).renameCategory("cat-1", {
      name: "Hogar",
    });

    expect(result).toMatchObject({ ok: true, data: { name: "Hogar" } });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/categories/cat-1");
    expect(fetchImpl.mock.calls[0][1].method).toBe("PATCH");
    expect(fetchImpl.mock.calls[0][1].body).toBe('{"name":"Hogar"}');
  });

  it("archives a category with POST and an empty object body", async () => {
    const archived = { ...category, isArchived: true };
    const fetchImpl = respondWith(
      jsonResponse(200, { data: archived, requestId: REQUEST_ID }),
    );

    const result = await apiWith(fetchImpl).archiveCategory("cat-1");

    expect(result).toMatchObject({ ok: true, data: archived });
    expect(fetchImpl).toHaveBeenCalledWith("/api/categories/cat-1/archive", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: undefined,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: "{}",
    });
  });

  it("reorders active categories with PUT", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: [category], requestId: REQUEST_ID }),
    );

    const result = await apiWith(fetchImpl).reorderCategories({
      type: "expense",
      orderedCategoryIds: ["cat-1", "cat-2"],
    });

    expect(result).toMatchObject({ ok: true, data: [category] });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/categories/order");
    expect(fetchImpl.mock.calls[0][1].method).toBe("PUT");
    expect(fetchImpl.mock.calls[0][1].body).toBe(
      '{"type":"expense","orderedCategoryIds":["cat-1","cat-2"]}',
    );
  });

  it("encodes a reserved character in a category identifier", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: category, requestId: REQUEST_ID }),
    );

    await apiWith(fetchImpl).renameCategory("a/b", { name: "Casa" });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/categories/a%2Fb");
  });
});

describe("classificationApi tags", () => {
  it("lists tags with GET and an optional lifecycle filter", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, { data: [tag], requestId: REQUEST_ID }),
    );

    await apiWith(fetchImpl).listTags();
    await apiWith(fetchImpl).listTags({ status: "all" });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/tags");
    expect(fetchImpl.mock.calls[0][1].method).toBe("GET");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/tags?status=all");
  });

  it("creates a tag with POST", async () => {
    const fetchImpl = respondWith(
      jsonResponse(201, { data: tag, requestId: REQUEST_ID }),
    );

    const result = await apiWith(fetchImpl).createTag({ name: "Año" });

    expect(result).toMatchObject({ ok: true, status: 201, data: tag });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/tags");
    expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
    expect(fetchImpl.mock.calls[0][1].body).toBe('{"name":"Año"}');
  });

  it("renames a tag with PATCH", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, {
        data: { ...tag, name: "Ocio" },
        requestId: REQUEST_ID,
      }),
    );

    await apiWith(fetchImpl).renameTag("tag-1", { name: "Ocio" });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/tags/tag-1");
    expect(fetchImpl.mock.calls[0][1].method).toBe("PATCH");
    expect(fetchImpl.mock.calls[0][1].body).toBe('{"name":"Ocio"}');
  });

  it("archives a tag with POST and an empty object body", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, {
        data: { ...tag, isArchived: true },
        requestId: REQUEST_ID,
      }),
    );

    await apiWith(fetchImpl).archiveTag("tag-1");

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/tags/tag-1/archive");
    expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
    expect(fetchImpl.mock.calls[0][1].body).toBe("{}");
  });
});

describe("classificationApi validation and errors", () => {
  it("keeps a 422 field list from the server", async () => {
    const fetchImpl = respondWith(
      jsonResponse(422, {
        error: {
          code: "validationFailed",
          message: API_ERROR_MESSAGE.validationFailed,
          requestId: REQUEST_ID,
          details: [{ field: "name", code: "duplicateName" }],
        },
      }),
    );

    const result = await apiWith(fetchImpl).createCategory({
      name: "Casa",
      type: "expense",
    });

    expect(result).toEqual({
      ok: false,
      reason: "api",
      status: 422,
      error: {
        code: "validationFailed",
        message: "Los datos enviados no son válidos.",
        requestId: REQUEST_ID,
        details: [{ field: "name", code: "duplicateName" }],
      },
    });
  });

  it("rejects a category payload that carries storage fields", async () => {
    const fetchImpl = respondWith(
      jsonResponse(200, {
        data: { ...category, workspaceId: "w-1" },
        requestId: REQUEST_ID,
      }),
    );

    const result = await apiWith(fetchImpl).listCategories();

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 200,
    });
  });

  it("rejects a tag payload that omits isArchived", async () => {
    const fetchImpl = respondWith(
      jsonResponse(201, {
        data: { id: "tag-1", name: "Viajes" },
        requestId: REQUEST_ID,
      }),
    );

    const result = await apiWith(fetchImpl).createTag({ name: "Viajes" });

    expect(result).toEqual({
      ok: false,
      reason: "invalidResponse",
      status: 201,
    });
  });
});
