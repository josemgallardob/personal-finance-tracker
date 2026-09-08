import { describe, expect, it } from "vitest";

import { createTag, type Tag } from "../domain/tag";
import { failed, succeeded } from "./ports/classification-repository";
import type { TagRepository } from "./ports/tag-repository";
import type { UnitOfWork } from "./ports/unit-of-work";
import { resolveTags } from "./resolve-tags";

const transactional: UnitOfWork = { isTransactional: true };
const autocommit: UnitOfWork = { isTransactional: false };

function unused(): never {
  throw new Error("Unexpected repository method");
}

function repository(overrides: Partial<TagRepository> = {}): TagRepository {
  return {
    listTags: unused,
    findTagById: unused,
    findActiveTagByNormalizedName: unused,
    insertTag: unused,
    renameTag: unused,
    archiveTag: unused,
    ...overrides,
  };
}

function built(name: string, id = "tag-1"): Tag {
  const tag = createTag({ id, name, archivedAt: null });

  if (!tag.ok) {
    throw new Error("Expected a valid tag");
  }

  return tag.value;
}

describe("resolveTags", () => {
  it("refuses an autocommit unit so a cancelled save cannot keep tags", () => {
    expect(
      resolveTags(autocommit, repository(), {
        workspaceId: "workspace-1",
        tags: [{ name: "Navidad" }],
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "tags", code: "unavailable" }],
    });
  });

  it("reuses the winner of a same-name insert race", () => {
    const winner = built("Navidad", "winner");
    const result = resolveTags(
      transactional,
      repository({
        findActiveTagByNormalizedName: () => succeeded(null),
        insertTag: () => failed("duplicateName"),
      }),
      { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
      { createId: () => "new-id" },
    );

    const retried = resolveTags(
      transactional,
      repository({
        findActiveTagByNormalizedName: (() => {
          let calls = 0;
          return () => {
            calls += 1;
            return calls === 1 ? succeeded(null) : succeeded(winner);
          };
        })(),
        insertTag: () => failed("duplicateName"),
      }),
      { workspaceId: "workspace-1", tags: [{ name: "  NAVIDAD  " }] },
      { createId: () => "new-id" },
    );

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "name", code: "duplicateName" }],
    });
    expect(retried).toEqual({ ok: true, value: [winner] });
  });

  it("translates lookup and insert refusals into field errors", () => {
    expect(
      resolveTags(
        transactional,
        repository({
          findTagById: () => failed("storageFailure", "closed"),
        }),
        { workspaceId: "workspace-1", tags: [{ tagId: "tag-1" }] },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      resolveTags(
        transactional,
        repository({
          findActiveTagByNormalizedName: () => failed("storageFailure", "name"),
        }),
        { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
        { createId: () => "tag-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      resolveTags(
        transactional,
        repository({
          findActiveTagByNormalizedName: () => succeeded(null),
          insertTag: () => failed("unknownWorkspace"),
        }),
        { workspaceId: "missing", tags: [{ name: "Navidad" }] },
        { createId: () => "tag-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "workspaceId", code: "notFound" }],
    });
    expect(
      resolveTags(
        transactional,
        repository({
          findActiveTagByNormalizedName: () => succeeded(null),
          insertTag: () => failed("alreadyArchived"),
        }),
        { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
        { createId: () => "tag-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "tagId", code: "alreadyArchived" }],
    });
    expect(
      resolveTags(
        transactional,
        repository({
          findActiveTagByNormalizedName: () => succeeded(null),
          insertTag: () => failed("categoryNotFound"),
        }),
        { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
        { createId: () => "tag-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "tagId", code: "notFound" }],
    });
    expect(
      resolveTags(
        transactional,
        repository({
          findActiveTagByNormalizedName: () => succeeded(null),
          insertTag: () => failed("invalidStoredRow"),
        }),
        { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
        { createId: () => "tag-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      resolveTags(
        transactional,
        repository({
          findActiveTagByNormalizedName: () => succeeded(null),
          insertTag: () => failed("transactionRequired"),
        }),
        { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
        { createId: () => "tag-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      resolveTags(
        transactional,
        repository({
          findActiveTagByNormalizedName: () => succeeded(null),
          insertTag: () => failed("invalidCategoryOrder"),
        }),
        { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
        { createId: () => "tag-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      resolveTags(
        transactional,
        repository({
          findActiveTagByNormalizedName: () => succeeded(null),
          insertTag: () => failed("duplicateId"),
        }),
        { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
        { createId: () => "tag-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "id", code: "invalidIdentifier" }],
    });
    expect(
      resolveTags(
        transactional,
        repository({
          findActiveTagByNormalizedName: () => failed("duplicateName"),
        }),
        { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
        { createId: () => "tag-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "name", code: "duplicateName" }],
    });
    expect(
      resolveTags(
        transactional,
        repository({
          findTagById: () => failed("tagNotFound"),
        }),
        { workspaceId: "workspace-1", tags: [{ tagId: "tag-1" }] },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "tagId", code: "notFound" }],
    });
  });

  it("returns a controlled conflict when the racing row cannot be read back", () => {
    expect(
      resolveTags(
        transactional,
        repository({
          findActiveTagByNormalizedName: () => succeeded(null),
          insertTag: () => failed("duplicateName"),
        }),
        { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
        { createId: () => "tag-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "name", code: "duplicateName" }],
    });
    expect(
      resolveTags(
        transactional,
        repository({
          findActiveTagByNormalizedName: (() => {
            let calls = 0;
            return () => {
              calls += 1;
              return calls === 1
                ? succeeded(null)
                : failed("storageFailure", "retry");
            };
          })(),
          insertTag: () => failed("duplicateName"),
        }),
        { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
        { createId: () => "tag-1" },
      ),
    ).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("creates a missing name with the default identifier factory", () => {
    const created = resolveTags(
      transactional,
      repository({
        findActiveTagByNormalizedName: () => succeeded(null),
        insertTag: (_unit, command) => succeeded(command.tag),
      }),
      { workspaceId: "workspace-1", tags: [{ name: "Navidad" }] },
    );

    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value).toHaveLength(1);
      expect(created.value[0]?.name).toBe("Navidad");
      expect(created.value[0]?.id.length).toBeGreaterThan(0);
    }
  });
});
