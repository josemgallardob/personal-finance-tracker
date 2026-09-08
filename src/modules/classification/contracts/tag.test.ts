import { describe, expect, it } from "vitest";

import { createTag } from "../domain/tag";
import { toTagDto } from "./tag";

function tag(name: string, archivedAt: number | null) {
  const built = createTag({
    id: "tag-1",
    name,
    archivedAt,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid tag: ${JSON.stringify(built)}`);
  }

  return built.value;
}

describe("toTagDto", () => {
  it("exposes isArchived and hides storage fields of an active tag", () => {
    const dto = toTagDto(tag("  Viajes  ", null));

    expect(dto).toEqual({
      id: "tag-1",
      name: "Viajes",
      isArchived: false,
    });
    expect(Object.keys(dto).sort()).toEqual(["id", "isArchived", "name"]);
  });

  it("marks an archived tag without echoing the archive timestamp", () => {
    const dto = toTagDto(tag("Navidad", 1_746_268_800_000));

    expect(dto).toEqual({
      id: "tag-1",
      name: "Navidad",
      isArchived: true,
    });
    expect(dto).not.toHaveProperty("archivedAt");
    expect(dto).not.toHaveProperty("workspaceId");
    expect(dto).not.toHaveProperty("normalizedName");
  });
});
