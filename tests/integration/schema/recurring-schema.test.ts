/**
 * Constraints of the monthly recurrence tables on a real SQLite file.
 *
 * These tests run against the committed migrations with the production
 * PRAGMAs, so foreign keys, partial unique indexes and check constraints are
 * the real ones. Nothing here stubs the driver or relaxes a constraint.
 */

import { afterEach, describe, expect, it } from "vitest";

import { MAX_MONTHLY_DAY } from "../../../src/modules/recurring/domain/recurrence-calendar";
import { INITIAL_TEMPLATE_VERSION } from "../../../src/modules/recurring/domain/recurring-rule";
import { MAX_TRANSACTION_MINOR } from "../../../src/shared/domain/money";
import type { SqliteConnection } from "../../../src/shared/server/database";
import {
  createInitializedSchemaFixture,
  type InitializedSchemaFixture,
} from "./helpers";

const NOW = 1_746_268_800_000;
const FOREIGN_WORKSPACE_ID = "foreign-workspace";

const fixtures: InitializedSchemaFixture[] = [];

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

interface SeededSchema {
  readonly connection: SqliteConnection;
  readonly workspaceId: string;
}

function insertCategory(
  connection: SqliteConnection,
  values: {
    readonly id: string;
    readonly workspaceId: string;
    readonly type: string;
  },
): void {
  connection.sqlite
    .prepare(
      `INSERT INTO category (
         id, workspace_id, name, normalized_name, type, sort_order, archived_at
       ) VALUES (?, ?, ?, ?, ?, 0, NULL)`,
    )
    .run(values.id, values.workspaceId, values.id, values.id, values.type);
}

function insertTag(
  connection: SqliteConnection,
  id: string,
  workspaceId: string,
): void {
  connection.sqlite
    .prepare(
      `INSERT INTO tag (id, workspace_id, name, normalized_name, archived_at)
       VALUES (?, ?, ?, ?, NULL)`,
    )
    .run(id, workspaceId, id, id);
}

function insertTransaction(
  connection: SqliteConnection,
  values: {
    readonly id: string;
    readonly workspaceId: string;
    readonly categoryId?: string;
    readonly date?: string;
  },
): void {
  connection.sqlite
    .prepare(
      `INSERT INTO "transaction" (
         id, workspace_id, type, amount_minor, date, category_id,
         concept, note, created_at, updated_at
       ) VALUES (?, ?, 'expense', 1299, ?, ?, 'Suscripción', NULL, ?, ?)`,
    )
    .run(
      values.id,
      values.workspaceId,
      values.date ?? "2026-09-08",
      values.categoryId ?? "cat-expense",
      NOW,
      NOW,
    );
}

function insertRule(
  connection: SqliteConnection,
  values: {
    readonly id: string;
    readonly workspaceId: string;
    readonly sourceTransactionId?: string | null;
    readonly type?: string;
    readonly amountMinor?: number | string;
    readonly categoryId?: string;
    readonly monthlyDay?: number | string;
    readonly nextDueDate?: string;
    readonly templateVersion?: number;
    readonly deactivatedAt?: number | null;
  },
): void {
  connection.sqlite
    .prepare(
      `INSERT INTO recurring_rule (
         id, workspace_id, source_transaction_id, type, amount_minor,
         category_id, concept, note, monthly_day, next_due_date,
         template_version, deactivated_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'Suscripción', NULL, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.id,
      values.workspaceId,
      values.sourceTransactionId ?? null,
      values.type ?? "expense",
      values.amountMinor ?? 1299,
      values.categoryId ?? "cat-expense",
      values.monthlyDay ?? MAX_MONTHLY_DAY,
      values.nextDueDate ?? "2026-09-30",
      values.templateVersion ?? INITIAL_TEMPLATE_VERSION,
      values.deactivatedAt ?? null,
      NOW,
      NOW,
    );
}

function insertOccurrence(
  connection: SqliteConnection,
  values: {
    readonly id: string;
    readonly workspaceId: string;
    readonly recurringRuleId: string;
    readonly scheduledFor: string;
    readonly transactionId?: string | null;
  },
): void {
  connection.sqlite
    .prepare(
      `INSERT INTO recurring_occurrence (
         id, workspace_id, recurring_rule_id, scheduled_for, transaction_id,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.id,
      values.workspaceId,
      values.recurringRuleId,
      values.scheduledFor,
      values.transactionId ?? null,
      NOW,
    );
}

/** Opens a migrated file with the workspace, category and tag rules need. */
function seededSchema(): SeededSchema {
  const fixture = createInitializedSchemaFixture();
  fixtures.push(fixture);

  const { connection, workspaceId } = fixture;

  insertCategory(connection, {
    id: "cat-expense",
    workspaceId,
    type: "expense",
  });
  insertCategory(connection, { id: "cat-income", workspaceId, type: "income" });
  insertTag(connection, "tag-home", workspaceId);

  return { connection, workspaceId };
}

function readRule(connection: SqliteConnection, id: string) {
  return connection.sqlite
    .prepare(
      `SELECT source_transaction_id AS sourceTransactionId,
              amount_minor AS amountMinor,
              monthly_day AS monthlyDay,
              next_due_date AS nextDueDate,
              deactivated_at AS deactivatedAt
       FROM recurring_rule WHERE id = ?`,
    )
    .get(id);
}

function readOccurrences(connection: SqliteConnection) {
  return connection.sqlite
    .prepare(
      `SELECT id, recurring_rule_id AS recurringRuleId,
              scheduled_for AS scheduledFor, transaction_id AS transactionId
       FROM recurring_occurrence ORDER BY scheduled_for`,
    )
    .all();
}

describe("recurring occurrence uniqueness", () => {
  it("accepts one row per rule and scheduled day", () => {
    const { connection, workspaceId } = seededSchema();
    insertRule(connection, { id: "rule-1", workspaceId });
    insertRule(connection, { id: "rule-2", workspaceId });

    insertOccurrence(connection, {
      id: "occ-1",
      workspaceId,
      recurringRuleId: "rule-1",
      scheduledFor: "2026-08-31",
    });
    insertOccurrence(connection, {
      id: "occ-2",
      workspaceId,
      recurringRuleId: "rule-1",
      scheduledFor: "2026-09-30",
    });
    insertOccurrence(connection, {
      id: "occ-3",
      workspaceId,
      recurringRuleId: "rule-2",
      scheduledFor: "2026-08-31",
    });

    expect(readOccurrences(connection)).toHaveLength(3);
  });

  it("rejects a second row for the same rule and day", () => {
    const { connection, workspaceId } = seededSchema();
    insertRule(connection, { id: "rule-1", workspaceId });
    insertOccurrence(connection, {
      id: "occ-1",
      workspaceId,
      recurringRuleId: "rule-1",
      scheduledFor: "2026-09-30",
    });

    expect(() =>
      insertOccurrence(connection, {
        id: "occ-retry",
        workspaceId,
        recurringRuleId: "rule-1",
        scheduledFor: "2026-09-30",
      }),
    ).toThrow(/UNIQUE constraint failed/);
    expect(readOccurrences(connection)).toHaveLength(1);
  });

  it("binds a generated movement to at most one occurrence", () => {
    const { connection, workspaceId } = seededSchema();
    insertRule(connection, { id: "rule-1", workspaceId });
    insertTransaction(connection, { id: "tx-generated", workspaceId });
    insertOccurrence(connection, {
      id: "occ-1",
      workspaceId,
      recurringRuleId: "rule-1",
      scheduledFor: "2026-09-30",
      transactionId: "tx-generated",
    });

    expect(() =>
      insertOccurrence(connection, {
        id: "occ-2",
        workspaceId,
        recurringRuleId: "rule-1",
        scheduledFor: "2026-10-31",
        transactionId: "tx-generated",
      }),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("keeps several occurrences without a movement", () => {
    const { connection, workspaceId } = seededSchema();
    insertRule(connection, { id: "rule-1", workspaceId });
    insertOccurrence(connection, {
      id: "occ-1",
      workspaceId,
      recurringRuleId: "rule-1",
      scheduledFor: "2026-09-30",
      transactionId: null,
    });
    insertOccurrence(connection, {
      id: "occ-2",
      workspaceId,
      recurringRuleId: "rule-1",
      scheduledFor: "2026-10-31",
      transactionId: null,
    });

    expect(readOccurrences(connection)).toHaveLength(2);
  });
});

describe("deleting a generated movement", () => {
  it("keeps the processed date with an empty link", () => {
    const { connection, workspaceId } = seededSchema();
    insertRule(connection, { id: "rule-1", workspaceId });
    insertTransaction(connection, { id: "tx-generated", workspaceId });
    insertOccurrence(connection, {
      id: "occ-1",
      workspaceId,
      recurringRuleId: "rule-1",
      scheduledFor: "2026-09-30",
      transactionId: "tx-generated",
    });

    connection.sqlite
      .prepare(`DELETE FROM "transaction" WHERE id = ?`)
      .run("tx-generated");

    expect(readOccurrences(connection)).toEqual([
      {
        id: "occ-1",
        recurringRuleId: "rule-1",
        scheduledFor: "2026-09-30",
        transactionId: null,
      },
    ]);
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("does not let the generator repeat that date afterwards", () => {
    const { connection, workspaceId } = seededSchema();
    insertRule(connection, { id: "rule-1", workspaceId });
    insertTransaction(connection, { id: "tx-generated", workspaceId });
    insertOccurrence(connection, {
      id: "occ-1",
      workspaceId,
      recurringRuleId: "rule-1",
      scheduledFor: "2026-09-30",
      transactionId: "tx-generated",
    });
    connection.sqlite
      .prepare(`DELETE FROM "transaction" WHERE id = ?`)
      .run("tx-generated");

    insertTransaction(connection, { id: "tx-regenerated", workspaceId });

    expect(() =>
      insertOccurrence(connection, {
        id: "occ-again",
        workspaceId,
        recurringRuleId: "rule-1",
        scheduledFor: "2026-09-30",
        transactionId: "tx-regenerated",
      }),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("leaves the rule and its next date untouched", () => {
    const { connection, workspaceId } = seededSchema();
    insertTransaction(connection, { id: "tx-origin", workspaceId });
    insertRule(connection, {
      id: "rule-1",
      workspaceId,
      sourceTransactionId: "tx-origin",
    });
    insertTransaction(connection, { id: "tx-generated", workspaceId });
    insertOccurrence(connection, {
      id: "occ-1",
      workspaceId,
      recurringRuleId: "rule-1",
      scheduledFor: "2026-09-30",
      transactionId: "tx-generated",
    });

    connection.sqlite
      .prepare(`DELETE FROM "transaction" WHERE id = ?`)
      .run("tx-generated");

    expect(readRule(connection, "rule-1")).toEqual({
      sourceTransactionId: "tx-origin",
      amountMinor: 1299,
      monthlyDay: MAX_MONTHLY_DAY,
      nextDueDate: "2026-09-30",
      deactivatedAt: null,
    });
  });
});

describe("deleting the origin movement", () => {
  it("empties the origin link without stopping the rule", () => {
    const { connection, workspaceId } = seededSchema();
    insertTransaction(connection, { id: "tx-origin", workspaceId });
    insertRule(connection, {
      id: "rule-1",
      workspaceId,
      sourceTransactionId: "tx-origin",
    });

    connection.sqlite
      .prepare(`DELETE FROM "transaction" WHERE id = ?`)
      .run("tx-origin");

    expect(readRule(connection, "rule-1")).toEqual({
      sourceTransactionId: null,
      amountMinor: 1299,
      monthlyDay: MAX_MONTHLY_DAY,
      nextDueDate: "2026-09-30",
      deactivatedAt: null,
    });
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("keeps the template tags of the rule", () => {
    const { connection, workspaceId } = seededSchema();
    insertTransaction(connection, { id: "tx-origin", workspaceId });
    insertRule(connection, {
      id: "rule-1",
      workspaceId,
      sourceTransactionId: "tx-origin",
    });
    connection.sqlite
      .prepare(
        `INSERT INTO recurring_rule_tag (recurring_rule_id, tag_id, workspace_id)
         VALUES (?, ?, ?)`,
      )
      .run("rule-1", "tag-home", workspaceId);

    connection.sqlite
      .prepare(`DELETE FROM "transaction" WHERE id = ?`)
      .run("tx-origin");

    expect(
      connection.sqlite
        .prepare(
          `SELECT recurring_rule_id AS recurringRuleId, tag_id AS tagId
           FROM recurring_rule_tag`,
        )
        .all(),
    ).toEqual([{ recurringRuleId: "rule-1", tagId: "tag-home" }]);
  });
});

describe("origin links between movements and rules", () => {
  it("accepts at most one active rule per origin movement", () => {
    const { connection, workspaceId } = seededSchema();
    insertTransaction(connection, { id: "tx-origin", workspaceId });
    insertRule(connection, {
      id: "rule-active",
      workspaceId,
      sourceTransactionId: "tx-origin",
    });

    expect(() =>
      insertRule(connection, {
        id: "rule-second",
        workspaceId,
        sourceTransactionId: "tx-origin",
      }),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("accepts a new active rule once the previous one is deactivated", () => {
    const { connection, workspaceId } = seededSchema();
    insertTransaction(connection, { id: "tx-origin", workspaceId });
    insertRule(connection, {
      id: "rule-stopped",
      workspaceId,
      sourceTransactionId: "tx-origin",
      deactivatedAt: NOW,
    });

    insertRule(connection, {
      id: "rule-active",
      workspaceId,
      sourceTransactionId: "tx-origin",
    });

    expect(
      connection.sqlite
        .prepare(
          "SELECT id FROM recurring_rule WHERE source_transaction_id = ? ORDER BY id",
        )
        .all("tx-origin"),
    ).toEqual([{ id: "rule-active" }, { id: "rule-stopped" }]);
  });

  it("accepts many rules whose origin movement was deleted", () => {
    const { connection, workspaceId } = seededSchema();

    insertRule(connection, {
      id: "rule-1",
      workspaceId,
      sourceTransactionId: null,
    });
    insertRule(connection, {
      id: "rule-2",
      workspaceId,
      sourceTransactionId: null,
    });

    expect(
      connection.sqlite
        .prepare("SELECT COUNT(*) AS total FROM recurring_rule")
        .get(),
    ).toEqual({ total: 2 });
  });

  it("keeps the movement table free of a link back to a rule", () => {
    const { connection } = seededSchema();

    const referenced = new Set(
      (
        connection.sqlite.pragma(`foreign_key_list("transaction")`) as Array<{
          table: string;
        }>
      ).map((reference) => reference.table),
    );

    expect([...referenced].sort()).toEqual(["category", "workspace"]);
  });
});

describe("recurrence template constraints", () => {
  it("rejects a template category of the wrong type", () => {
    const { connection, workspaceId } = seededSchema();

    expect(() =>
      insertRule(connection, {
        id: "rule-1",
        workspaceId,
        categoryId: "cat-income",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("rejects a template category that does not exist", () => {
    const { connection, workspaceId } = seededSchema();

    expect(() =>
      insertRule(connection, {
        id: "rule-1",
        workspaceId,
        categoryId: "cat-absent",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("rejects an unsupported template type", () => {
    const { connection, workspaceId } = seededSchema();

    expect(() =>
      insertRule(connection, { id: "rule-1", workspaceId, type: "transfer" }),
    ).toThrow(/CHECK constraint failed: recurring_rule_type_is_supported/);
  });

  it("rejects a template amount outside the accepted range", () => {
    const { connection, workspaceId } = seededSchema();

    expect(() =>
      insertRule(connection, { id: "rule-0", workspaceId, amountMinor: 0 }),
    ).toThrow(
      /CHECK constraint failed: recurring_rule_amount_minor_is_accepted/,
    );
    expect(() =>
      insertRule(connection, {
        id: "rule-big",
        workspaceId,
        amountMinor: MAX_TRANSACTION_MINOR + 1,
      }),
    ).toThrow(
      /CHECK constraint failed: recurring_rule_amount_minor_is_accepted/,
    );
    expect(() =>
      insertRule(connection, {
        id: "rule-real",
        workspaceId,
        amountMinor: 12.5,
      }),
    ).toThrow(
      /CHECK constraint failed: recurring_rule_amount_minor_is_accepted/,
    );
  });

  it("rejects a monthly day outside 1 to 31", () => {
    const { connection, workspaceId } = seededSchema();

    expect(() =>
      insertRule(connection, { id: "rule-0", workspaceId, monthlyDay: 0 }),
    ).toThrow(
      /CHECK constraint failed: recurring_rule_monthly_day_is_accepted/,
    );
    expect(() =>
      insertRule(connection, {
        id: "rule-32",
        workspaceId,
        monthlyDay: MAX_MONTHLY_DAY + 1,
      }),
    ).toThrow(
      /CHECK constraint failed: recurring_rule_monthly_day_is_accepted/,
    );
    expect(() =>
      insertRule(connection, {
        id: "rule-real",
        workspaceId,
        monthlyDay: 15.5,
      }),
    ).toThrow(
      /CHECK constraint failed: recurring_rule_monthly_day_is_accepted/,
    );
  });

  it("accepts both extremes of the monthly day", () => {
    const { connection, workspaceId } = seededSchema();

    insertRule(connection, { id: "rule-first", workspaceId, monthlyDay: 1 });
    insertRule(connection, {
      id: "rule-last",
      workspaceId,
      monthlyDay: MAX_MONTHLY_DAY,
    });

    expect(
      connection.sqlite
        .prepare(
          "SELECT monthly_day AS monthlyDay FROM recurring_rule ORDER BY monthly_day",
        )
        .all(),
    ).toEqual([{ monthlyDay: 1 }, { monthlyDay: MAX_MONTHLY_DAY }]);
  });

  it("rejects a next due date that is not ISO day text", () => {
    const { connection, workspaceId } = seededSchema();

    expect(() =>
      insertRule(connection, {
        id: "rule-1",
        workspaceId,
        nextDueDate: "30/09/2026",
      }),
    ).toThrow(
      /CHECK constraint failed: recurring_rule_next_due_date_is_iso_day/,
    );
  });

  it("rejects a template version before the first stored one", () => {
    const { connection, workspaceId } = seededSchema();

    expect(() =>
      insertRule(connection, {
        id: "rule-1",
        workspaceId,
        templateVersion: 0,
      }),
    ).toThrow(
      /CHECK constraint failed: recurring_rule_template_version_is_accepted/,
    );
  });

  it("rejects a scheduled day that is not ISO day text", () => {
    const { connection, workspaceId } = seededSchema();
    insertRule(connection, { id: "rule-1", workspaceId });

    expect(() =>
      insertOccurrence(connection, {
        id: "occ-1",
        workspaceId,
        recurringRuleId: "rule-1",
        scheduledFor: "30/09/2026",
      }),
    ).toThrow(
      /CHECK constraint failed: recurring_occurrence_scheduled_for_is_iso_day/,
    );
  });
});

describe("workspace isolation of the recurrence tables", () => {
  it("rejects a rule that names a workspace outside this file", () => {
    const { connection } = seededSchema();

    expect(() =>
      insertRule(connection, {
        id: "rule-1",
        workspaceId: FOREIGN_WORKSPACE_ID,
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("rejects an occurrence whose workspace is not the one of its rule", () => {
    const { connection, workspaceId } = seededSchema();
    insertRule(connection, { id: "rule-1", workspaceId });

    expect(() =>
      insertOccurrence(connection, {
        id: "occ-1",
        workspaceId: FOREIGN_WORKSPACE_ID,
        recurringRuleId: "rule-1",
        scheduledFor: "2026-09-30",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("rejects a template tag association outside the workspace of its rule", () => {
    const { connection, workspaceId } = seededSchema();
    insertRule(connection, { id: "rule-1", workspaceId });

    expect(() =>
      connection.sqlite
        .prepare(
          `INSERT INTO recurring_rule_tag (recurring_rule_id, tag_id, workspace_id)
           VALUES (?, ?, ?)`,
        )
        .run("rule-1", "tag-home", FOREIGN_WORKSPACE_ID),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("rejects an occurrence whose rule does not exist", () => {
    const { connection, workspaceId } = seededSchema();

    expect(() =>
      insertOccurrence(connection, {
        id: "occ-1",
        workspaceId,
        recurringRuleId: "rule-absent",
        scheduledFor: "2026-09-30",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe("template tags of a rule", () => {
  it("rejects the same tag twice on one rule", () => {
    const { connection, workspaceId } = seededSchema();
    insertRule(connection, { id: "rule-1", workspaceId });
    const insert = connection.sqlite.prepare(
      `INSERT INTO recurring_rule_tag (recurring_rule_id, tag_id, workspace_id)
       VALUES (?, ?, ?)`,
    );
    insert.run("rule-1", "tag-home", workspaceId);

    expect(() => insert.run("rule-1", "tag-home", workspaceId)).toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it("keeps the tag row when the association disappears with its rule", () => {
    const { connection, workspaceId } = seededSchema();
    insertRule(connection, { id: "rule-1", workspaceId });
    connection.sqlite
      .prepare(
        `INSERT INTO recurring_rule_tag (recurring_rule_id, tag_id, workspace_id)
         VALUES (?, ?, ?)`,
      )
      .run("rule-1", "tag-home", workspaceId);

    connection.sqlite
      .prepare("DELETE FROM recurring_rule WHERE id = ?")
      .run("rule-1");

    expect(
      connection.sqlite
        .prepare("SELECT COUNT(*) AS total FROM recurring_rule_tag")
        .get(),
    ).toEqual({ total: 0 });
    expect(
      connection.sqlite.prepare("SELECT id FROM tag ORDER BY id").all(),
    ).toEqual([{ id: "tag-home" }]);
  });
});
