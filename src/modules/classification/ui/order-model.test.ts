import { describe, expect, it } from "vitest";

import {
  activeItemIds,
  moveActiveItem,
  moveDownLabel,
  moveUpLabel,
} from "./order-model";

const first = { id: "a", name: "Alquiler", isArchived: false };
const middle = { id: "b", name: "Supermercado", isArchived: false };
const last = { id: "c", name: "Coche", isArchived: false };
const archived = { id: "d", name: "Tabaco", isArchived: true };

describe("moveActiveItem", () => {
  it("moves a middle active row down and keeps archived rows after", () => {
    expect(
      moveActiveItem([first, middle, last, archived], middle.id, 1)?.map(
        (item) => item.id,
      ),
    ).toEqual(["a", "c", "b", "d"]);
  });

  it("moves the first active row down and refuses a move above the first", () => {
    expect(
      moveActiveItem([first, middle, last], first.id, 1)?.map(
        (item) => item.id,
      ),
    ).toEqual(["b", "a", "c"]);
    expect(moveActiveItem([first, middle, last], first.id, -1)).toBeNull();
  });

  it("moves the last active row up and refuses a move below the last", () => {
    expect(
      moveActiveItem([first, middle, last], last.id, -1)?.map(
        (item) => item.id,
      ),
    ).toEqual(["a", "c", "b"]);
    expect(moveActiveItem([first, middle, last], last.id, 1)).toBeNull();
  });

  it("ignores archived identifiers and unknown rows", () => {
    expect(moveActiveItem([first, archived], archived.id, 1)).toBeNull();
    expect(moveActiveItem([first, middle], "missing", 1)).toBeNull();
  });
});

describe("activeItemIds", () => {
  it("sends only active identifiers in display order", () => {
    expect(activeItemIds([first, archived, middle])).toEqual(["a", "b"]);
  });
});

describe("order labels", () => {
  it("names each direction with the category", () => {
    expect(moveUpLabel("Alquiler")).toBe("Subir Alquiler");
    expect(moveDownLabel("Alquiler")).toBe("Bajar Alquiler");
  });
});
