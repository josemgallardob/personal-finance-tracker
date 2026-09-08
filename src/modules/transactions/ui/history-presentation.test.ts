import { describe, expect, it } from "vitest";

import {
  HISTORY_ALL_TAB,
  HISTORY_RECURRING_TAB,
  readHistoryTab,
} from "./history-copy";
import {
  historyCategoryLabel,
  historyDateLabel,
  historyPrimaryLabel,
  historySignedAmount,
  historyTagNames,
  historyTypeLabel,
} from "./history-presentation";
import type { TransactionDto } from "../contracts/transaction";

const categories = [
  {
    id: "cat-food",
    name: "Alimentación",
    type: "expense" as const,
    isArchived: false,
  },
  {
    id: "cat-salary",
    name: "Nómina",
    type: "income" as const,
    isArchived: false,
  },
];

const tags = [
  { id: "tag-trips", name: "Viajes", isArchived: false },
  { id: "tag-home", name: "Casa", isArchived: false },
];

const expense: TransactionDto = {
  id: "tx-1",
  type: "expense",
  amountMinor: 1250,
  date: "2026-08-01",
  categoryId: "cat-food",
  concept: "  Supermercado  ",
  note: null,
  tagIds: ["tag-trips", "missing", "tag-home"],
};

describe("readHistoryTab", () => {
  it("treats a missing or unknown tab as Todos", () => {
    expect(readHistoryTab(undefined)).toBe(HISTORY_ALL_TAB);
    expect(readHistoryTab("all")).toBe(HISTORY_ALL_TAB);
    expect(readHistoryTab("other")).toBe(HISTORY_ALL_TAB);
    expect(readHistoryTab(["all", "recurring"])).toBe(HISTORY_ALL_TAB);
  });

  it("selects Recurrentes only for the recurring value", () => {
    expect(readHistoryTab("recurring")).toBe(HISTORY_RECURRING_TAB);
    expect(readHistoryTab(["recurring"])).toBe(HISTORY_RECURRING_TAB);
  });
});

describe("history presentation", () => {
  it("prefers a trimmed concept and keeps API tag order", () => {
    expect(historyPrimaryLabel(expense, categories)).toBe("Supermercado");
    expect(historyCategoryLabel(expense, categories)).toBe("Alimentación");
    expect(historyTagNames(expense, tags)).toEqual(["Viajes", "Casa"]);
    expect(historyDateLabel(expense)).toBe("01/08/2026");
    expect(historyTypeLabel(expense)).toBe("Gasto");
    expect(historySignedAmount(expense).replace(/[\u00a0\u202f]/g, " ")).toBe(
      "−12,50 €",
    );
  });

  it("falls back to the category, then to a generic label", () => {
    const withoutConcept = {
      ...expense,
      concept: "   ",
      categoryId: "cat-food",
    };
    expect(historyPrimaryLabel(withoutConcept, categories)).toBe(
      "Alimentación",
    );

    const unknownCategory = { ...expense, concept: null, categoryId: "gone" };
    expect(historyPrimaryLabel(unknownCategory, categories)).toBe("Movimiento");
    expect(historyCategoryLabel(unknownCategory, categories)).toBe(
      "Movimiento",
    );
  });

  it("marks income with a plus sign", () => {
    const income: TransactionDto = {
      ...expense,
      type: "income",
      categoryId: "cat-salary",
      amountMinor: 1250,
    };

    expect(historyTypeLabel(income)).toBe("Ingreso");
    expect(historySignedAmount(income).replace(/[\u00a0\u202f]/g, " ")).toBe(
      "+12,50 €",
    );
  });
});
