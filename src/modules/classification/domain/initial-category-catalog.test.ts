import { describe, expect, it } from "vitest";

import { isIdentifier, nameKey } from "../../../shared/domain/text";
import { createCategory } from "./category";
import {
  INITIAL_CATEGORY_CATALOG,
  INITIAL_EXPENSE_CATEGORIES,
  INITIAL_INCOME_CATEGORIES,
  categoryPresentation,
  initialCategorySortOrder,
  type InitialCategorySeed,
} from "./initial-category-catalog";

const EXPECTED_EXPENSE_NAMES = [
  "Alquiler",
  "Suministros",
  "Supermercado",
  "Coche",
  "Transporte",
  "Formación",
  "Gimnasio",
  "Deportes",
  "Peluquería",
  "Suscripciones",
  "Comida a domicilio o para llevar",
  "Tabaco",
  "Moda",
  "Ropa y equipación deportiva",
  "Libros",
  "Tecnología",
  "Videojuegos",
  "Salud",
  "Cuidado personal",
  "Casa",
  "Regalos",
  "Viajes",
  "Ocio",
  "Otros",
] as const;

const EXPECTED_INCOME_NAMES = ["Sueldo", "Ventas", "Regalos", "Otros"] as const;

describe("initial category catalog", () => {
  it("contains the exact 24 expense and 4 income labels of US-03", () => {
    expect(INITIAL_EXPENSE_CATEGORIES).toHaveLength(24);
    expect(INITIAL_INCOME_CATEGORIES).toHaveLength(4);
    expect(INITIAL_CATEGORY_CATALOG).toHaveLength(28);
    expect(INITIAL_EXPENSE_CATEGORIES.map((seed) => seed.name)).toEqual([
      ...EXPECTED_EXPENSE_NAMES,
    ]);
    expect(INITIAL_INCOME_CATEGORIES.map((seed) => seed.name)).toEqual([
      ...EXPECTED_INCOME_NAMES,
    ]);
    expect(INITIAL_CATEGORY_CATALOG.map((seed) => seed.type)).toEqual([
      ...Array.from({ length: 24 }, () => "expense"),
      ...Array.from({ length: 4 }, () => "income"),
    ]);
  });

  it("gives every seed a stable identifier and a valid domain category", () => {
    const ids = INITIAL_CATEGORY_CATALOG.map((seed) => seed.id);

    expect(new Set(ids).size).toBe(28);
    expect(ids.every((id) => id.startsWith("seed-") && isIdentifier(id))).toBe(
      true,
    );

    for (const [index, seed] of INITIAL_EXPENSE_CATEGORIES.entries()) {
      const built = createCategory({
        id: seed.id,
        name: seed.name,
        type: seed.type,
        sortOrder: index,
        archivedAt: null,
      });

      expect(built.ok).toBe(true);
      if (built.ok) {
        expect(built.value.normalizedName).toBe(nameKey(seed.name));
        expect(initialCategorySortOrder(seed)).toBe(index);
      }
    }

    for (const [index, seed] of INITIAL_INCOME_CATEGORIES.entries()) {
      expect(initialCategorySortOrder(seed)).toBe(index);
    }
  });

  it("keeps income and expense gift and other categories distinct", () => {
    const expenseGifts = INITIAL_EXPENSE_CATEGORIES.find(
      (seed) => seed.name === "Regalos",
    );
    const incomeGifts = INITIAL_INCOME_CATEGORIES.find(
      (seed) => seed.name === "Regalos",
    );
    const expenseOther = INITIAL_EXPENSE_CATEGORIES.find(
      (seed) => seed.name === "Otros",
    );
    const incomeOther = INITIAL_INCOME_CATEGORIES.find(
      (seed) => seed.name === "Otros",
    );

    expect(expenseGifts?.id).toBe("seed-exp-regalos");
    expect(incomeGifts?.id).toBe("seed-inc-regalos");
    expect(expenseOther?.id).toBe("seed-exp-otros");
    expect(incomeOther?.id).toBe("seed-inc-otros");
    expect(expenseGifts?.id).not.toBe(incomeGifts?.id);
    expect(expenseOther?.id).not.toBe(incomeOther?.id);
    expect(categoryPresentation(expenseGifts?.id ?? "")).not.toEqual(
      categoryPresentation(incomeGifts?.id ?? ""),
    );
    expect(categoryPresentation(expenseOther?.id ?? "")).not.toEqual(
      categoryPresentation(incomeOther?.id ?? ""),
    );
  });

  it("returns -1 for a seed that is not in the accepted catalog", () => {
    const unknown: InitialCategorySeed = {
      id: "seed-exp-unknown",
      name: "Desconocida",
      type: "expense",
      iconKey: "unknown",
      color: "#FFFFFF",
    };

    expect(initialCategorySortOrder(unknown)).toBe(-1);
  });
});

describe("categoryPresentation", () => {
  it("returns the catalog presentation for every seed identifier", () => {
    for (const seed of INITIAL_CATEGORY_CATALOG) {
      expect(categoryPresentation(seed.id)).toEqual({
        iconKey: seed.iconKey,
        color: seed.color,
      });
    }
  });

  it("is deterministic for identifiers that are not in the catalog", () => {
    const first = categoryPresentation("user-created-category");
    const second = categoryPresentation("user-created-category");
    const other = categoryPresentation("another-user-category");

    expect(first).toEqual(second);
    expect(first.iconKey.length).toBeGreaterThan(0);
    expect(first.color).toMatch(/^#[0-9A-F]{6}$/);
    expect(other).not.toEqual(first);
  });
});
