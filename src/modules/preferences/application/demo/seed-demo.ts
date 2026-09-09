/**
 * Deterministic fictitious data for the isolated demonstration database.
 *
 * All replacement happens in one SQLite transaction. IDs are stable and dates
 * are relative to the injected Madrid clock, so resetting twice on one day
 * produces exactly the same dataset without ever reading personal storage.
 */

import "server-only";

import type { Clock } from "../../../../shared/domain/clock";
import {
  createLocalDate,
  daysInMonth,
  localDateParts,
  type LocalDate,
} from "../../../../shared/domain/dates";
import type { SqliteConnection } from "../../../../shared/server/database";

export const DEMO_WORKSPACE_ID = "demo-workspace";

export interface DemoSeedSummary {
  readonly transactionCount: number;
  readonly recurringRuleCount: number;
}

export type DemoSeedResult =
  | { readonly ok: true; readonly value: DemoSeedSummary }
  | { readonly ok: false; readonly error: { readonly code: "seedFailed" } };

interface DemoTransaction {
  readonly id: string;
  readonly type: "income" | "expense";
  readonly amountMinor: number;
  readonly date: LocalDate;
  readonly categoryId: string;
  readonly concept: string;
  readonly tags: readonly string[];
}

const CATEGORIES = [
  ["demo-income-salary", "Nómina", "nómina", "income", 0],
  ["demo-income-extra", "Ingresos extra", "ingresos extra", "income", 1],
  ["demo-expense-home", "Hogar", "hogar", "expense", 0],
  ["demo-expense-food", "Alimentación", "alimentación", "expense", 1],
  ["demo-expense-transport", "Transporte", "transporte", "expense", 2],
  ["demo-expense-leisure", "Ocio", "ocio", "expense", 3],
  [
    "demo-expense-archived",
    "Proyecto cerrado",
    "proyecto cerrado",
    "expense",
    4,
  ],
] as const;

const TAGS = [
  ["demo-tag-essential", "Esencial", "esencial"],
  ["demo-tag-shared", "Compartido", "compartido"],
  ["demo-tag-travel", "Viajes", "viajes"],
  ["demo-tag-archived", "Etiqueta histórica", "etiqueta histórica"],
] as const;

/** Replaces only the database represented by `connection` with fictitious data. */
export function seedDemoDatabase(
  connection: SqliteConnection,
  clock: Clock,
): DemoSeedResult {
  const today = clock.today();
  const rows = demoTransactions(today);
  const now = demoTimestamp(today);

  try {
    connection.sqlite.transaction(() => {
      connection.sqlite.exec(`
        DELETE FROM recurring_occurrence;
        DELETE FROM recurring_rule_tag;
        DELETE FROM recurring_rule;
        DELETE FROM transaction_tag;
        DELETE FROM "transaction";
        DELETE FROM tag;
        DELETE FROM category;
        DELETE FROM preference;
        DELETE FROM workspace;
      `);

      connection.sqlite
        .prepare(
          "INSERT INTO workspace (id, kind, created_at) VALUES (?, 'personal', ?)",
        )
        .run(DEMO_WORKSPACE_ID, now);
      connection.sqlite
        .prepare(
          `INSERT INTO preference (
            workspace_id, locale, currency, time_zone, created_at, updated_at
          ) VALUES (?, 'es-ES', 'EUR', 'Europe/Madrid', ?, ?)`,
        )
        .run(DEMO_WORKSPACE_ID, now, now);

      const insertCategory = connection.sqlite.prepare(
        `INSERT INTO category (
          id, workspace_id, name, normalized_name, type, sort_order, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [id, name, normalizedName, type, sortOrder] of CATEGORIES) {
        insertCategory.run(
          id,
          DEMO_WORKSPACE_ID,
          name,
          normalizedName,
          type,
          sortOrder,
          id === "demo-expense-archived" ? now : null,
        );
      }

      const insertTag = connection.sqlite.prepare(
        `INSERT INTO tag (
          id, workspace_id, name, normalized_name, archived_at
        ) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const [id, name, normalizedName] of TAGS) {
        insertTag.run(
          id,
          DEMO_WORKSPACE_ID,
          name,
          normalizedName,
          id === "demo-tag-archived" ? now : null,
        );
      }

      const insertTransaction = connection.sqlite.prepare(
        `INSERT INTO "transaction" (
          id, workspace_id, type, amount_minor, date, category_id, concept,
          note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      );
      const insertTransactionTag = connection.sqlite.prepare(
        "INSERT INTO transaction_tag (transaction_id, tag_id, workspace_id) VALUES (?, ?, ?)",
      );
      for (const row of rows) {
        insertTransaction.run(
          row.id,
          DEMO_WORKSPACE_ID,
          row.type,
          row.amountMinor,
          row.date,
          row.categoryId,
          row.concept,
          now,
          now,
        );
        for (const tagId of row.tags) {
          insertTransactionTag.run(row.id, tagId, DEMO_WORKSPACE_ID);
        }
      }

      connection.sqlite
        .prepare(
          `INSERT INTO recurring_rule (
            id, workspace_id, source_transaction_id, type, amount_minor,
            category_id, concept, note, monthly_day, next_due_date,
            template_version, deactivated_at, created_at, updated_at
          ) VALUES (?, ?, ?, 'expense', ?, ?, ?, NULL, ?, ?, 1, NULL, ?, ?)`,
        )
        .run(
          "demo-recurring-rent",
          DEMO_WORKSPACE_ID,
          "demo-expense-01-rent",
          89500,
          "demo-expense-home",
          "Alquiler",
          1,
          monthDate(today, 1, 1),
          now,
          now,
        );
      connection.sqlite
        .prepare(
          "INSERT INTO recurring_rule_tag (recurring_rule_id, tag_id, workspace_id) VALUES (?, ?, ?)",
        )
        .run("demo-recurring-rent", "demo-tag-essential", DEMO_WORKSPACE_ID);
      connection.sqlite
        .prepare(
          `INSERT INTO recurring_occurrence (
            id, workspace_id, recurring_rule_id, scheduled_for, transaction_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "demo-occurrence-rent",
          DEMO_WORKSPACE_ID,
          "demo-recurring-rent",
          monthDate(today, 2, 1),
          "demo-expense-02-rent",
          now,
        );
    })();
  } catch {
    return { ok: false, error: { code: "seedFailed" } };
  }

  return {
    ok: true,
    value: { transactionCount: rows.length, recurringRuleCount: 1 },
  };
}

function demoTransactions(today: LocalDate): readonly DemoTransaction[] {
  const transactions: DemoTransaction[] = [];

  for (let offset = 13; offset >= 0; offset -= 1) {
    // Two deliberately empty calendar months demonstrate zero-value averages.
    if (offset === 10 || offset === 5) {
      continue;
    }

    const prefix = `demo-${String(offset).padStart(2, "0")}`;
    transactions.push(
      {
        id: `${prefix}-salary`,
        type: "income",
        amountMinor: 245000,
        date: monthDate(today, offset, 5),
        categoryId: "demo-income-salary",
        concept: "Nómina",
        tags: [],
      },
      {
        id: `${prefix}-groceries`,
        type: "expense",
        amountMinor: 32000 + offset * 100,
        date: monthDate(today, offset, 12),
        categoryId: "demo-expense-food",
        concept: "Compra semanal",
        tags: ["demo-tag-essential", "demo-tag-shared"],
      },
      {
        id: `${prefix}-transport`,
        type: "expense",
        amountMinor: 4800 + offset * 10,
        date: monthDate(today, offset, 18),
        categoryId: "demo-expense-transport",
        concept: "Abono transporte",
        tags: ["demo-tag-essential"],
      },
    );
  }

  transactions.push(
    {
      id: "demo-expense-01-rent",
      type: "expense",
      amountMinor: 89500,
      date: monthDate(today, 3, 1),
      categoryId: "demo-expense-home",
      concept: "Alquiler",
      tags: ["demo-tag-essential", "demo-tag-shared"],
    },
    {
      id: "demo-expense-02-rent",
      type: "expense",
      amountMinor: 89500,
      date: monthDate(today, 2, 1),
      categoryId: "demo-expense-home",
      concept: "Alquiler",
      tags: ["demo-tag-essential", "demo-tag-shared"],
    },
    {
      id: "demo-travel",
      type: "expense",
      amountMinor: 41200,
      date: monthDate(today, 1, 22),
      categoryId: "demo-expense-leisure",
      concept: "Escapada ficticia",
      tags: ["demo-tag-travel", "demo-tag-shared"],
    },
    {
      id: "demo-archived",
      type: "expense",
      amountMinor: 1200,
      date: monthDate(today, 12, 20),
      categoryId: "demo-expense-archived",
      concept: "Proyecto histórico",
      tags: ["demo-tag-archived"],
    },
  );

  return transactions;
}

function monthDate(
  today: LocalDate,
  monthsBefore: number,
  day: number,
): LocalDate {
  const parts = localDateParts(today);
  const absoluteMonth = parts.year * 12 + (parts.month - 1) - monthsBefore;
  const year = Math.floor(absoluteMonth / 12);
  const month = (absoluteMonth % 12) + 1;
  const built = createLocalDate(
    year,
    month,
    Math.min(day, daysInMonth(year, month)),
  );

  if (!built.ok) {
    throw new Error("Demo seed date construction failed.");
  }

  return built.value;
}

function demoTimestamp(today: LocalDate): number {
  const { year, month, day } = localDateParts(today);
  return Date.UTC(year, month - 1, day, 12);
}
