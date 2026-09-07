import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_TRANSACTION_MINOR,
  MIN_TRANSACTION_MINOR,
} from "../../../src/shared/domain/money";
import type { SqliteConnection } from "../../../src/shared/server/database";
import {
  createInitializedSchemaFixture,
  type InitializedSchemaFixture,
} from "./helpers";

const FOREIGN_WORKSPACE_ID = "foreign-workspace";
const NOW = 1_746_268_800_000;

const fixtures: InitializedSchemaFixture[] = [];

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

function openedSchema() {
  const fixture = createInitializedSchemaFixture();
  fixtures.push(fixture);
  return fixture;
}

function insertCategory(
  connection: SqliteConnection,
  values: {
    readonly id: string;
    readonly workspaceId: string;
    readonly name?: string;
    readonly normalizedName?: string;
    readonly type: string;
    readonly sortOrder?: number;
    readonly archivedAt?: number | null;
  },
) {
  connection.sqlite
    .prepare(
      `INSERT INTO category (
         id, workspace_id, name, normalized_name, type, sort_order, archived_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.id,
      values.workspaceId,
      values.name ?? values.id,
      values.normalizedName ?? values.id,
      values.type,
      values.sortOrder ?? 0,
      values.archivedAt ?? null,
    );
}

function insertTag(
  connection: SqliteConnection,
  values: {
    readonly id: string;
    readonly workspaceId: string;
    readonly name?: string;
    readonly normalizedName?: string;
    readonly archivedAt?: number | null;
  },
) {
  connection.sqlite
    .prepare(
      `INSERT INTO tag (
         id, workspace_id, name, normalized_name, archived_at
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      values.id,
      values.workspaceId,
      values.name ?? values.id,
      values.normalizedName ?? values.id,
      values.archivedAt ?? null,
    );
}

function insertTransaction(
  connection: SqliteConnection,
  values: {
    readonly id: string;
    readonly workspaceId: string;
    readonly type: string;
    readonly amountMinor?: number;
    readonly date?: string;
    readonly categoryId: string;
    readonly concept?: string | null;
    readonly note?: string | null;
  },
) {
  connection.sqlite
    .prepare(
      `INSERT INTO "transaction" (
         id, workspace_id, type, amount_minor, date, category_id,
         concept, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.id,
      values.workspaceId,
      values.type,
      values.amountMinor ?? 250,
      values.date ?? "2026-09-06",
      values.categoryId,
      values.concept ?? null,
      values.note ?? null,
      NOW,
      NOW,
    );
}

/** Inserts an amount exactly as given, without the numeric helper signature. */
function insertRawAmount(
  connection: SqliteConnection,
  id: string,
  workspaceId: string,
  amountMinor: number | string,
) {
  connection.sqlite
    .prepare(
      `INSERT INTO "transaction" (
         id, workspace_id, type, amount_minor, date, category_id,
         concept, note, created_at, updated_at
       ) VALUES (?, ?, 'expense', ?, '2026-09-06', 'cat-expense', NULL, NULL, ?, ?)`,
    )
    .run(id, workspaceId, amountMinor, NOW, NOW);
}

/** Reads every stored amount with the SQLite storage class it ended up in. */
function storedAmounts(connection: SqliteConnection) {
  return connection.sqlite
    .prepare(
      `SELECT id, amount_minor AS amountMinor, typeof(amount_minor) AS storedType
       FROM "transaction" ORDER BY id`,
    )
    .all();
}

function insertTransactionTag(
  connection: SqliteConnection,
  values: {
    readonly transactionId: string;
    readonly tagId: string;
    readonly workspaceId: string;
  },
) {
  connection.sqlite
    .prepare(
      `INSERT INTO transaction_tag (transaction_id, tag_id, workspace_id)
       VALUES (?, ?, ?)`,
    )
    .run(values.transactionId, values.tagId, values.workspaceId);
}

function seedExpenseMovement(
  connection: SqliteConnection,
  workspaceId: string,
  extras: { readonly tagIds?: readonly string[] } = {},
) {
  insertCategory(connection, {
    id: "cat-expense",
    workspaceId,
    type: "expense",
    name: "Supermercado",
    normalizedName: "supermercado",
  });
  insertTransaction(connection, {
    id: "tx-expense",
    workspaceId,
    type: "expense",
    categoryId: "cat-expense",
    amountMinor: 1299,
    concept: "Compra semanal",
  });

  for (const tagId of extras.tagIds ?? []) {
    insertTag(connection, {
      id: tagId,
      workspaceId,
      name: tagId,
      normalizedName: tagId,
    });
    insertTransactionTag(connection, {
      transactionId: "tx-expense",
      tagId,
      workspaceId,
    });
  }
}

function indexSql(
  connection: SqliteConnection,
  name: string,
): string | undefined {
  const row = connection.sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(name) as { sql: string } | undefined;
  return row?.sql;
}

function foreignKeys(connection: SqliteConnection, table: string) {
  return connection.sqlite
    .prepare(
      `SELECT id, "table" AS parent, "from" AS "from", "to" AS "to", on_delete AS onDelete
       FROM pragma_foreign_key_list(?)
       ORDER BY id, seq`,
    )
    .all(table) as Array<{
    id: number;
    parent: string;
    from: string;
    to: string;
    onDelete: string;
  }>;
}

describe("classification and transaction schema", () => {
  it("keeps the single personal workspace constraint from the previous migration", () => {
    const { connection } = openedSchema();

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO workspace (id, kind, created_at) VALUES (?, ?, ?)",
        )
        .run("second-personal", "personal", NOW),
    ).toThrow(/UNIQUE constraint failed: workspace\.kind/);
    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO workspace (id, kind, created_at) VALUES (?, ?, ?)",
        )
        .run("shared-workspace", "shared", NOW),
    ).toThrow(/CHECK constraint failed: workspace_kind_is_personal/);
  });

  it("exposes history indexes and active normalized uniqueness", () => {
    const { connection } = openedSchema();

    expect(
      indexSql(connection, "category_active_normalized_name_unique"),
    ).toMatch(
      /UNIQUE INDEX `category_active_normalized_name_unique`[\s\S]*WHERE "category"\."archived_at" is null/,
    );
    expect(indexSql(connection, "tag_active_normalized_name_unique")).toMatch(
      /UNIQUE INDEX `tag_active_normalized_name_unique`[\s\S]*WHERE "tag"\."archived_at" is null/,
    );
    expect(indexSql(connection, "category_normalized_name_idx")).toMatch(
      /ON `category` \(`workspace_id`,`type`,`normalized_name`\)/,
    );
    expect(indexSql(connection, "tag_normalized_name_idx")).toMatch(
      /ON `tag` \(`workspace_id`,`normalized_name`\)/,
    );
    expect(indexSql(connection, "transaction_workspace_date_idx")).toMatch(
      /ON `transaction` \(`workspace_id`,`date`\)/,
    );
    expect(indexSql(connection, "transaction_workspace_type_date_idx")).toMatch(
      /ON `transaction` \(`workspace_id`,`type`,`date`\)/,
    );
    expect(indexSql(connection, "transaction_category_date_idx")).toMatch(
      /ON `transaction` \(`category_id`,`date`\)/,
    );
    expect(indexSql(connection, "transaction_tag_tag_transaction_idx")).toMatch(
      /ON `transaction_tag` \(`tag_id`,`transaction_id`\)/,
    );
  });

  it("encodes workspace-safe and type-compatible associations", () => {
    const { connection } = openedSchema();

    expect(foreignKeys(connection, "transaction")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parent: "workspace",
          from: "workspace_id",
          to: "id",
        }),
        expect.objectContaining({
          parent: "category",
          from: "category_id",
          to: "id",
        }),
        expect.objectContaining({
          parent: "category",
          from: "workspace_id",
          to: "workspace_id",
        }),
        expect.objectContaining({
          parent: "category",
          from: "type",
          to: "type",
        }),
      ]),
    );
    expect(foreignKeys(connection, "transaction_tag")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parent: "transaction",
          from: "transaction_id",
          to: "id",
          onDelete: "CASCADE",
        }),
        expect.objectContaining({
          parent: "transaction",
          from: "workspace_id",
          to: "workspace_id",
          onDelete: "CASCADE",
        }),
        expect.objectContaining({
          parent: "tag",
          from: "tag_id",
          to: "id",
          onDelete: "NO ACTION",
        }),
        expect.objectContaining({
          parent: "tag",
          from: "workspace_id",
          to: "workspace_id",
          onDelete: "NO ACTION",
        }),
      ]),
    );
  });

  it("accepts a valid expense, income and tag association then reads them back", () => {
    const { connection, workspaceId } = openedSchema();

    insertCategory(connection, {
      id: "cat-expense",
      workspaceId,
      type: "expense",
      name: "Supermercado",
      normalizedName: "supermercado",
    });
    insertCategory(connection, {
      id: "cat-income",
      workspaceId,
      type: "income",
      name: "Nómina",
      normalizedName: "nómina",
    });
    insertTag(connection, {
      id: "tag-home",
      workspaceId,
      name: "Casa",
      normalizedName: "casa",
    });
    insertTransaction(connection, {
      id: "tx-expense",
      workspaceId,
      type: "expense",
      categoryId: "cat-expense",
      amountMinor: MIN_TRANSACTION_MINOR,
      date: "2026-01-31",
      concept: "Pan",
    });
    insertTransaction(connection, {
      id: "tx-income",
      workspaceId,
      type: "income",
      categoryId: "cat-income",
      amountMinor: MAX_TRANSACTION_MINOR,
      date: "2026-02-01",
      note: "Pago mensual",
    });
    insertTransactionTag(connection, {
      transactionId: "tx-expense",
      tagId: "tag-home",
      workspaceId,
    });

    expect(
      connection.sqlite
        .prepare(
          `SELECT t.id, t.type, t.amount_minor AS amountMinor, t.date, c.normalized_name AS categoryName
           FROM "transaction" t
           INNER JOIN category c ON c.id = t.category_id AND c.workspace_id = t.workspace_id
           ORDER BY t.date`,
        )
        .all(),
    ).toEqual([
      {
        id: "tx-expense",
        type: "expense",
        amountMinor: MIN_TRANSACTION_MINOR,
        date: "2026-01-31",
        categoryName: "supermercado",
      },
      {
        id: "tx-income",
        type: "income",
        amountMinor: MAX_TRANSACTION_MINOR,
        date: "2026-02-01",
        categoryName: "nómina",
      },
    ]);
    expect(
      connection.sqlite
        .prepare(
          "SELECT transaction_id AS transactionId, tag_id AS tagId FROM transaction_tag",
        )
        .all(),
    ).toEqual([{ transactionId: "tx-expense", tagId: "tag-home" }]);
  });

  it("rejects invalid amounts and unsupported types", () => {
    const { connection, workspaceId } = openedSchema();
    insertCategory(connection, {
      id: "cat-expense",
      workspaceId,
      type: "expense",
    });

    expect(() =>
      insertCategory(connection, {
        id: "cat-transfer",
        workspaceId,
        type: "transfer",
      }),
    ).toThrow(/CHECK constraint failed: category_type_is_supported/);
    expect(() =>
      insertTransaction(connection, {
        id: "tx-zero",
        workspaceId,
        type: "expense",
        categoryId: "cat-expense",
        amountMinor: 0,
      }),
    ).toThrow(/CHECK constraint failed: transaction_amount_minor_is_accepted/);
    expect(() =>
      insertTransaction(connection, {
        id: "tx-negative",
        workspaceId,
        type: "expense",
        categoryId: "cat-expense",
        amountMinor: -1,
      }),
    ).toThrow(/CHECK constraint failed: transaction_amount_minor_is_accepted/);
    expect(() =>
      insertTransaction(connection, {
        id: "tx-too-large",
        workspaceId,
        type: "expense",
        categoryId: "cat-expense",
        amountMinor: MAX_TRANSACTION_MINOR + 1,
      }),
    ).toThrow(/CHECK constraint failed: transaction_amount_minor_is_accepted/);
    expect(() =>
      insertTransaction(connection, {
        id: "tx-transfer",
        workspaceId,
        type: "transfer",
        categoryId: "cat-expense",
      }),
    ).toThrow(/CHECK constraint failed: transaction_type_is_supported/);
    expect(() =>
      insertTransaction(connection, {
        id: "tx-bad-date",
        workspaceId,
        type: "expense",
        categoryId: "cat-expense",
        date: "06/09/2026",
      }),
    ).toThrow(/CHECK constraint failed: transaction_date_is_iso_day/);
  });

  it("rejects fractional minor amounts on insert and update", () => {
    const { connection, workspaceId } = openedSchema();
    insertCategory(connection, {
      id: "cat-expense",
      workspaceId,
      type: "expense",
    });
    insertTransaction(connection, {
      id: "tx-exact",
      workspaceId,
      type: "expense",
      categoryId: "cat-expense",
      amountMinor: 1299,
    });

    expect(() =>
      insertTransaction(connection, {
        id: "tx-fractional",
        workspaceId,
        type: "expense",
        categoryId: "cat-expense",
        amountMinor: 12.5,
      }),
    ).toThrow(/CHECK constraint failed: transaction_amount_minor_is_accepted/);
    expect(() =>
      insertRawAmount(connection, "tx-fractional-text", workspaceId, "12.5"),
    ).toThrow(/CHECK constraint failed: transaction_amount_minor_is_accepted/);
    expect(() =>
      connection.sqlite
        .prepare(`UPDATE "transaction" SET amount_minor = 7.25 WHERE id = ?`)
        .run("tx-exact"),
    ).toThrow(/CHECK constraint failed: transaction_amount_minor_is_accepted/);

    insertRawAmount(connection, "tx-lossless-real", workspaceId, 1250.0);
    insertRawAmount(connection, "tx-lossless-text", workspaceId, "250");
    insertTransaction(connection, {
      id: "tx-minimum",
      workspaceId,
      type: "expense",
      categoryId: "cat-expense",
      amountMinor: MIN_TRANSACTION_MINOR,
    });
    insertTransaction(connection, {
      id: "tx-maximum",
      workspaceId,
      type: "expense",
      categoryId: "cat-expense",
      amountMinor: MAX_TRANSACTION_MINOR,
    });
    connection.sqlite
      .prepare(`UPDATE "transaction" SET amount_minor = 725 WHERE id = ?`)
      .run("tx-exact");

    expect(storedAmounts(connection)).toEqual([
      { id: "tx-exact", amountMinor: 725, storedType: "integer" },
      { id: "tx-lossless-real", amountMinor: 1250, storedType: "integer" },
      { id: "tx-lossless-text", amountMinor: 250, storedType: "integer" },
      {
        id: "tx-maximum",
        amountMinor: MAX_TRANSACTION_MINOR,
        storedType: "integer",
      },
      {
        id: "tx-minimum",
        amountMinor: MIN_TRANSACTION_MINOR,
        storedType: "integer",
      },
    ]);
  });

  it("rejects a category whose type does not match the transaction", () => {
    const { connection, workspaceId } = openedSchema();
    insertCategory(connection, {
      id: "cat-income",
      workspaceId,
      type: "income",
    });

    expect(() =>
      insertTransaction(connection, {
        id: "tx-mismatch",
        workspaceId,
        type: "expense",
        categoryId: "cat-income",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      insertTransaction(connection, {
        id: "tx-case",
        workspaceId,
        type: "Income",
        categoryId: "cat-income",
      }),
    ).toThrow(/CHECK constraint failed: transaction_type_is_supported/);
  });

  it("rejects a supplied workspace id that is not the personal workspace", () => {
    const { connection, workspaceId } = openedSchema();
    insertCategory(connection, {
      id: "cat-expense",
      workspaceId,
      type: "expense",
    });
    insertTag(connection, { id: "tag-home", workspaceId });
    insertTransaction(connection, {
      id: "tx-expense",
      workspaceId,
      type: "expense",
      categoryId: "cat-expense",
    });

    expect(() =>
      insertCategory(connection, {
        id: "cat-foreign",
        workspaceId: FOREIGN_WORKSPACE_ID,
        type: "expense",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      insertTag(connection, {
        id: "tag-foreign",
        workspaceId: FOREIGN_WORKSPACE_ID,
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      insertTransaction(connection, {
        id: "tx-foreign",
        workspaceId: FOREIGN_WORKSPACE_ID,
        type: "expense",
        categoryId: "cat-expense",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      insertTransactionTag(connection, {
        transactionId: "tx-expense",
        tagId: "tag-home",
        workspaceId: FOREIGN_WORKSPACE_ID,
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("rejects missing category, tag and transaction references", () => {
    const { connection, workspaceId } = openedSchema();
    insertCategory(connection, {
      id: "cat-expense",
      workspaceId,
      type: "expense",
    });
    insertTag(connection, { id: "tag-home", workspaceId });
    insertTransaction(connection, {
      id: "tx-expense",
      workspaceId,
      type: "expense",
      categoryId: "cat-expense",
    });

    expect(() =>
      insertTransaction(connection, {
        id: "tx-missing-category",
        workspaceId,
        type: "expense",
        categoryId: "missing-category",
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      insertTransactionTag(connection, {
        transactionId: "tx-expense",
        tagId: "missing-tag",
        workspaceId,
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      insertTransactionTag(connection, {
        transactionId: "missing-transaction",
        tagId: "tag-home",
        workspaceId,
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("rejects duplicate active normalized names and allows them after archive", () => {
    const { connection, workspaceId } = openedSchema();
    insertCategory(connection, {
      id: "cat-food",
      workspaceId,
      type: "expense",
      name: "Comida",
      normalizedName: "comida",
    });
    insertCategory(connection, {
      id: "cat-salary",
      workspaceId,
      type: "income",
      name: "Comida",
      normalizedName: "comida",
    });
    insertTag(connection, {
      id: "tag-home",
      workspaceId,
      name: "Casa",
      normalizedName: "casa",
    });

    expect(() =>
      insertCategory(connection, {
        id: "cat-food-2",
        workspaceId,
        type: "expense",
        name: "comida",
        normalizedName: "comida",
      }),
    ).toThrow(
      /UNIQUE constraint failed: category\.workspace_id, category\.type, category\.normalized_name/,
    );
    expect(() =>
      insertTag(connection, {
        id: "tag-home-2",
        workspaceId,
        name: "casa",
        normalizedName: "casa",
      }),
    ).toThrow(
      /UNIQUE constraint failed: tag\.workspace_id, tag\.normalized_name/,
    );

    connection.sqlite
      .prepare("UPDATE category SET archived_at = ? WHERE id = ?")
      .run(NOW, "cat-food");
    connection.sqlite
      .prepare("UPDATE tag SET archived_at = ? WHERE id = ?")
      .run(NOW, "tag-home");

    insertCategory(connection, {
      id: "cat-food-new",
      workspaceId,
      type: "expense",
      name: "Comida",
      normalizedName: "comida",
    });
    insertTag(connection, {
      id: "tag-home-new",
      workspaceId,
      name: "Casa",
      normalizedName: "casa",
    });

    expect(
      connection.sqlite
        .prepare(
          "SELECT id FROM category WHERE normalized_name = 'comida' ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: "cat-food" },
      { id: "cat-food-new" },
      { id: "cat-salary" },
    ]);
  });

  it("rejects a repeated tag on the same transaction", () => {
    const { connection, workspaceId } = openedSchema();
    seedExpenseMovement(connection, workspaceId, { tagIds: ["tag-home"] });

    expect(() =>
      insertTransactionTag(connection, {
        transactionId: "tx-expense",
        tagId: "tag-home",
        workspaceId,
      }),
    ).toThrow(
      /UNIQUE constraint failed: transaction_tag\.transaction_id, transaction_tag\.tag_id/,
    );
  });

  it("deletes only transaction_tag rows when a transaction is removed", () => {
    const { connection, workspaceId } = openedSchema();
    seedExpenseMovement(connection, workspaceId, {
      tagIds: ["tag-home", "tag-trip"],
    });

    expect(
      connection.sqlite
        .prepare("SELECT COUNT(*) AS count FROM transaction_tag")
        .get(),
    ).toEqual({ count: 2 });

    connection.sqlite
      .prepare(`DELETE FROM "transaction" WHERE id = ?`)
      .run("tx-expense");

    expect(
      connection.sqlite
        .prepare("SELECT COUNT(*) AS count FROM transaction_tag")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      connection.sqlite.prepare("SELECT id FROM category ORDER BY id").all(),
    ).toEqual([{ id: "cat-expense" }]);
    expect(
      connection.sqlite.prepare("SELECT id FROM tag ORDER BY id").all(),
    ).toEqual([{ id: "tag-home" }, { id: "tag-trip" }]);
  });

  it("does not cascade a category or tag delete onto historical rows", () => {
    const { connection, workspaceId } = openedSchema();
    seedExpenseMovement(connection, workspaceId, { tagIds: ["tag-home"] });

    expect(() =>
      connection.sqlite
        .prepare("DELETE FROM category WHERE id = ?")
        .run("cat-expense"),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      connection.sqlite.prepare("DELETE FROM tag WHERE id = ?").run("tag-home"),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(
      connection.sqlite.prepare(`SELECT id FROM "transaction"`).get(),
    ).toEqual({ id: "tx-expense" });
    expect(
      connection.sqlite
        .prepare("SELECT tag_id AS tagId FROM transaction_tag")
        .all(),
    ).toEqual([{ tagId: "tag-home" }]);
  });

  it("keeps an archived category associated with its historical transaction", () => {
    const { connection, workspaceId } = openedSchema();
    seedExpenseMovement(connection, workspaceId);

    connection.sqlite
      .prepare("UPDATE category SET archived_at = ? WHERE id = ?")
      .run(NOW, "cat-expense");

    expect(
      connection.sqlite
        .prepare(
          `SELECT t.id, c.archived_at AS archivedAt
           FROM "transaction" t
           INNER JOIN category c
             ON c.id = t.category_id AND c.workspace_id = t.workspace_id`,
        )
        .get(),
    ).toEqual({ id: "tx-expense", archivedAt: NOW });
  });

  it("rejects a negative sort order and a type change that would break compatibility", () => {
    const { connection, workspaceId } = openedSchema();
    seedExpenseMovement(connection, workspaceId);

    expect(() =>
      insertCategory(connection, {
        id: "cat-bad-order",
        workspaceId,
        type: "expense",
        sortOrder: -1,
      }),
    ).toThrow(/CHECK constraint failed: category_sort_order_is_non_negative/);
    expect(() =>
      connection.sqlite
        .prepare(`UPDATE "transaction" SET type = ? WHERE id = ?`)
        .run("income", "tx-expense"),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
