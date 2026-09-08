/**
 * Initial category catalog of the personal workspace.
 *
 * The 24 expense names and 4 income names are the accepted US-03 list, with
 * stable seed identifiers so a later restart can find the same rows. Icon and
 * color are not stored: they are derived from those identifiers so the same
 * category always looks the same in filters and charts, including after a
 * rename. Gift and other exist once per type, so income and expense keep
 * separate rows, identifiers and presentation.
 */

import type { TransactionType } from "../../transactions/domain/transaction-type";

/** Automatic presentation of a category, derived from its identifier. */
export interface CategoryPresentation {
  readonly iconKey: string;
  readonly color: string;
}

/** One row of the accepted initial catalog. */
export interface InitialCategorySeed {
  readonly id: string;
  readonly name: string;
  readonly type: TransactionType;
  readonly iconKey: string;
  readonly color: string;
}

/** Expense categories the first personal workspace starts with, in order. */
export const INITIAL_EXPENSE_CATEGORIES: readonly InitialCategorySeed[] = [
  {
    id: "seed-exp-alquiler",
    name: "Alquiler",
    type: "expense",
    iconKey: "rent",
    color: "#5B8CFF",
  },
  {
    id: "seed-exp-suministros",
    name: "Suministros",
    type: "expense",
    iconKey: "utilities",
    color: "#F0B429",
  },
  {
    id: "seed-exp-supermercado",
    name: "Supermercado",
    type: "expense",
    iconKey: "groceries",
    color: "#3DDC97",
  },
  {
    id: "seed-exp-coche",
    name: "Coche",
    type: "expense",
    iconKey: "car",
    color: "#FF8A4C",
  },
  {
    id: "seed-exp-transporte",
    name: "Transporte",
    type: "expense",
    iconKey: "transit",
    color: "#6EC8FF",
  },
  {
    id: "seed-exp-formacion",
    name: "Formación",
    type: "expense",
    iconKey: "education",
    color: "#A78BFA",
  },
  {
    id: "seed-exp-gimnasio",
    name: "Gimnasio",
    type: "expense",
    iconKey: "gym",
    color: "#FF6B9D",
  },
  {
    id: "seed-exp-deportes",
    name: "Deportes",
    type: "expense",
    iconKey: "sports",
    color: "#7CFF6B",
  },
  {
    id: "seed-exp-peluqueria",
    name: "Peluquería",
    type: "expense",
    iconKey: "salon",
    color: "#FF7AD9",
  },
  {
    id: "seed-exp-suscripciones",
    name: "Suscripciones",
    type: "expense",
    iconKey: "subscriptions",
    color: "#64D2FF",
  },
  {
    id: "seed-exp-comida-domicilio",
    name: "Comida a domicilio o para llevar",
    type: "expense",
    iconKey: "takeaway",
    color: "#FFB020",
  },
  {
    id: "seed-exp-tabaco",
    name: "Tabaco",
    type: "expense",
    iconKey: "tobacco",
    color: "#C4A574",
  },
  {
    id: "seed-exp-moda",
    name: "Moda",
    type: "expense",
    iconKey: "fashion",
    color: "#FF5C8A",
  },
  {
    id: "seed-exp-ropa-deportiva",
    name: "Ropa y equipación deportiva",
    type: "expense",
    iconKey: "sportswear",
    color: "#4ADE80",
  },
  {
    id: "seed-exp-libros",
    name: "Libros",
    type: "expense",
    iconKey: "books",
    color: "#FBBF24",
  },
  {
    id: "seed-exp-tecnologia",
    name: "Tecnología",
    type: "expense",
    iconKey: "tech",
    color: "#818CF8",
  },
  {
    id: "seed-exp-videojuegos",
    name: "Videojuegos",
    type: "expense",
    iconKey: "games",
    color: "#22D3EE",
  },
  {
    id: "seed-exp-salud",
    name: "Salud",
    type: "expense",
    iconKey: "health",
    color: "#34D399",
  },
  {
    id: "seed-exp-cuidado-personal",
    name: "Cuidado personal",
    type: "expense",
    iconKey: "personal-care",
    color: "#F472B6",
  },
  {
    id: "seed-exp-casa",
    name: "Casa",
    type: "expense",
    iconKey: "home",
    color: "#FB923C",
  },
  {
    id: "seed-exp-regalos",
    name: "Regalos",
    type: "expense",
    iconKey: "gifts",
    color: "#F87171",
  },
  {
    id: "seed-exp-viajes",
    name: "Viajes",
    type: "expense",
    iconKey: "travel",
    color: "#38BDF8",
  },
  {
    id: "seed-exp-ocio",
    name: "Ocio",
    type: "expense",
    iconKey: "leisure",
    color: "#A3E635",
  },
  {
    id: "seed-exp-otros",
    name: "Otros",
    type: "expense",
    iconKey: "other",
    color: "#94A3B8",
  },
];

/** Income categories the first personal workspace starts with, in order. */
export const INITIAL_INCOME_CATEGORIES: readonly InitialCategorySeed[] = [
  {
    id: "seed-inc-sueldo",
    name: "Sueldo",
    type: "income",
    iconKey: "salary",
    color: "#00A87E",
  },
  {
    id: "seed-inc-ventas",
    name: "Ventas",
    type: "income",
    iconKey: "sales",
    color: "#2DD4BF",
  },
  {
    id: "seed-inc-regalos",
    name: "Regalos",
    type: "income",
    iconKey: "gifts-received",
    color: "#FBBF24",
  },
  {
    id: "seed-inc-otros",
    name: "Otros",
    type: "income",
    iconKey: "other-income",
    color: "#67E8F9",
  },
];

/** Complete accepted catalog, expenses first, then income. */
export const INITIAL_CATEGORY_CATALOG: readonly InitialCategorySeed[] = [
  ...INITIAL_EXPENSE_CATEGORIES,
  ...INITIAL_INCOME_CATEGORIES,
];

const SEEDED_PRESENTATION = new Map<string, CategoryPresentation>(
  INITIAL_CATEGORY_CATALOG.map((seed) => [
    seed.id,
    { iconKey: seed.iconKey, color: seed.color },
  ]),
);

const FALLBACK_ICON_KEYS = INITIAL_CATEGORY_CATALOG.map((seed) => seed.iconKey);
const FALLBACK_COLORS = INITIAL_CATEGORY_CATALOG.map((seed) => seed.color);

/**
 * Default sort order of a seed inside its type. Archived or colliding rows are
 * skipped at runtime, but the remaining seeds keep this original position so a
 * partial catalog still matches the accepted list.
 */
export function initialCategorySortOrder(seed: InitialCategorySeed): number {
  const catalog =
    seed.type === "expense"
      ? INITIAL_EXPENSE_CATEGORIES
      : INITIAL_INCOME_CATEGORIES;

  return catalog.findIndex((item) => item.id === seed.id);
}

/**
 * Automatic icon and color of a category.
 *
 * Seeded identifiers keep the presentation assigned in the catalog. Any other
 * identifier hashes to the same palettes, so a user-created category also gets
 * a stable combination without storing extra columns.
 */
export function categoryPresentation(categoryId: string): CategoryPresentation {
  const seeded = SEEDED_PRESENTATION.get(categoryId);

  if (seeded) {
    return seeded;
  }

  const hash = identifierHash(categoryId);
  const iconIndex = hash % FALLBACK_ICON_KEYS.length;
  const colorIndex =
    Math.floor(hash / FALLBACK_ICON_KEYS.length) % FALLBACK_COLORS.length;

  return {
    iconKey: FALLBACK_ICON_KEYS[iconIndex] as string,
    color: FALLBACK_COLORS[colorIndex] as string,
  };
}

/** Stable non-cryptographic hash used only to pick a fallback combination. */
function identifierHash(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}
