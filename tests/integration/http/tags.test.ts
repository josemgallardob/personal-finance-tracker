/**
 * Tag HTTP endpoints against a real, migrated SQLite file.
 *
 * The handlers run GET/POST collection, PATCH rename and POST archive through
 * the real tag maintenance services. Recurrence protection is out of scope.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createArchiveTagHandler,
  createCreateTagHandler,
  createListTagsHandler,
  createRenameTagHandler,
} from "../../../src/modules/classification/server/tag-http";
import type { ApiHandlerDeps } from "../../../src/shared/server/http/handler";
import {
  buildRequest,
  createHttpFixture,
  createLogCollector,
  openConnectionFrom,
  readEnvelope,
  storeTag,
  type HttpFixture,
} from "./helpers";

const NOW = 1_746_268_800_000;
const FOREIGN_ID = "foreign-tag-id";

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

describe("GET /api/tags", () => {
  it("lists active tags by default and hides storage fields", async () => {
    const viajes = storeTag(fixture, "Viajes");
    storeTag(fixture, "Navidad");
    fixture.connection.sqlite
      .prepare("UPDATE tag SET archived_at = ? WHERE name = ?")
      .run(NOW, "Navidad");

    const payload = await parse(
      await createListTagsHandler(deps())(
        buildRequest({ path: "/api/tags", requestId: "req-tags" }),
      ),
    );

    expect(payload.status).toBe(200);
    expect(payload.body).toEqual({
      data: [{ id: viajes.id, name: "Viajes", isArchived: false }],
      requestId: "req-tags",
    });
    expect(JSON.stringify(payload.body)).not.toContain("workspace");
    expect(JSON.stringify(payload.body)).not.toContain("archivedAt");
  });

  it("filters archived and all statuses", async () => {
    storeTag(fixture, "Viajes");
    const navidad = storeTag(fixture, "Navidad");
    fixture.connection.sqlite
      .prepare("UPDATE tag SET archived_at = ? WHERE name = ?")
      .run(NOW, "Navidad");

    const archived = await parse(
      await createListTagsHandler(deps())(
        buildRequest({ path: "/api/tags?status=archived" }),
      ),
    );
    const all = await parse(
      await createListTagsHandler(deps())(
        buildRequest({ path: "/api/tags?status=all" }),
      ),
    );

    expect(archived.body).toMatchObject({
      data: [{ id: navidad.id, name: "Navidad", isArchived: true }],
    });
    expect(
      (all.body as { data: { name: string }[] }).data.map((row) => row.name),
    ).toEqual(["Viajes", "Navidad"]);
  });

  it("refuses a type filter that tags do not accept", async () => {
    const response = await parse(
      await createListTagsHandler(deps())(
        buildRequest({ path: "/api/tags?type=expense" }),
      ),
    );

    expect(response).toMatchObject({
      status: 422,
      body: {
        error: { details: [{ field: "type", code: "unknownField" }] },
      },
    });
  });
});

describe("POST /api/tags", () => {
  it("creates a tag and conflicts on a normalized duplicate", async () => {
    const created = await parse(
      await createCreateTagHandler(deps())(
        jsonRequest("POST", "/api/tags", { name: "  Viajes  " }, "req-tag"),
      ),
    );
    const duplicate = await parse(
      await createCreateTagHandler(deps())(
        jsonRequest("POST", "/api/tags", { name: "viajes" }),
      ),
    );

    expect(created).toMatchObject({
      status: 201,
      body: {
        data: { name: "Viajes", isArchived: false },
        requestId: "req-tag",
      },
    });
    expect(duplicate).toMatchObject({
      status: 409,
      body: {
        error: {
          code: "conflict",
          details: [{ field: "name", code: "duplicateName" }],
        },
      },
    });
  });

  it("refuses an empty name", async () => {
    const empty = await parse(
      await createCreateTagHandler(deps())(
        jsonRequest("POST", "/api/tags", { name: "   " }),
      ),
    );

    expect(empty).toMatchObject({
      status: 422,
      body: {
        error: {
          code: "validationFailed",
          details: [{ field: "name", code: "required" }],
        },
      },
    });
  });
});

describe("PATCH /api/tags/[id]", () => {
  it("renames a tag and refuses a foreign identifier", async () => {
    const tag = storeTag(fixture, "Viajes");

    const renamed = await parse(
      await createRenameTagHandler(deps())(
        jsonRequest("PATCH", `/api/tags/${tag.id}`, { name: "Vacaciones" }),
      ),
    );
    const missing = await parse(
      await createRenameTagHandler(deps())(
        jsonRequest("PATCH", `/api/tags/${FOREIGN_ID}`, { name: "Otro" }),
      ),
    );

    expect(renamed).toMatchObject({
      status: 200,
      body: { data: { id: tag.id, name: "Vacaciones", isArchived: false } },
    });
    expect(missing).toMatchObject({
      status: 404,
      body: {
        error: {
          code: "notFound",
          details: [{ field: "tagId", code: "notFound" }],
        },
      },
    });
  });

  it("refuses a rename whose path is not a tag item", async () => {
    const response = await parse(
      await createRenameTagHandler(deps())(
        jsonRequest("PATCH", "/api/tags", { name: "Otro" }),
      ),
    );

    expect(response.status).toBe(404);
  });
});

describe("POST /api/tags/[id]/archive", () => {
  it("archives a tag and keeps it in the historical list", async () => {
    const tag = storeTag(fixture, "Navidad");

    const archived = await parse(
      await createArchiveTagHandler(deps())(
        jsonRequest("POST", `/api/tags/${tag.id}/archive`, {}),
      ),
    );
    const historical = await parse(
      await createListTagsHandler(deps())(
        buildRequest({ path: "/api/tags?status=all" }),
      ),
    );

    expect(archived).toMatchObject({
      status: 200,
      body: { data: { id: tag.id, name: "Navidad", isArchived: true } },
    });
    expect(
      (historical.body as { data: { isArchived: boolean }[] }).data,
    ).toEqual([{ id: tag.id, name: "Navidad", isArchived: true }]);
  });

  it("conflicts when the tag is already archived", async () => {
    const tag = storeTag(fixture, "Navidad");
    await createArchiveTagHandler(deps())(
      jsonRequest("POST", `/api/tags/${tag.id}/archive`, {}),
    );

    const second = await parse(
      await createArchiveTagHandler(deps())(
        jsonRequest("POST", `/api/tags/${tag.id}/archive`, {}),
      ),
    );

    expect(second).toMatchObject({
      status: 409,
      body: {
        error: {
          details: [{ field: "tagId", code: "alreadyArchived" }],
        },
      },
    });
  });

  it("refuses an archive request whose path has no tag identifier", async () => {
    const response = await parse(
      await createArchiveTagHandler(deps())(
        jsonRequest("POST", "/api/tags", {}),
      ),
    );

    expect(response.status).toBe(404);
  });

  it("answers a service failure when a stored tag is unreadable", async () => {
    const tag = storeTag(fixture, "Viajes");
    fixture.connection.sqlite
      .prepare("UPDATE tag SET name = ?, normalized_name = ? WHERE id = ?")
      .run("a".repeat(81), "a".repeat(81), tag.id);

    const response = await parse(
      await createListTagsHandler(deps())(buildRequest({ path: "/api/tags" })),
    );

    expect(response.status).toBe(503);
  });
});
