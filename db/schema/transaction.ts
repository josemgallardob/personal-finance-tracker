/**
 * Transaction and association tables for recorded movements.
 *
 * Amount and type are checked in SQL. Category compatibility and same-workspace
 * membership are composite foreign keys. Recurrence columns are added later;
 * deleting a transaction cascades only its tag associations.
 */

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  MAX_TRANSACTION_MINOR,
  MIN_TRANSACTION_MINOR,
} from "../../src/shared/domain/money";
import { TRANSACTION_TYPES } from "../../src/modules/transactions/domain/transaction-type";
import { category, tag } from "./classification";
import { workspace } from "./workspace";

export const TRANSACTION_DATE_GLOB =
  "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]";

export const transaction = sqliteTable(
  "transaction",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    type: text("type").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    date: text("date").notNull(),
    categoryId: text("category_id").notNull(),
    concept: text("concept"),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "transaction_workspace_id_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
    }),
    foreignKey({
      name: "transaction_category_workspace_fk",
      columns: [table.categoryId, table.workspaceId],
      foreignColumns: [category.id, category.workspaceId],
    }),
    foreignKey({
      name: "transaction_category_type_fk",
      columns: [table.categoryId, table.type],
      foreignColumns: [category.id, category.type],
    }),
    uniqueIndex("transaction_id_workspace_unique").on(
      table.id,
      table.workspaceId,
    ),
    index("transaction_workspace_date_idx").on(table.workspaceId, table.date),
    index("transaction_workspace_type_date_idx").on(
      table.workspaceId,
      table.type,
      table.date,
    ),
    index("transaction_category_date_idx").on(table.categoryId, table.date),
    check(
      "transaction_type_is_supported",
      sql.raw(
        `"transaction"."type" IN (${TRANSACTION_TYPES.map((type) => `'${type}'`).join(", ")})`,
      ),
    ),
    check(
      "transaction_amount_minor_is_accepted",
      sql`typeof(${table.amountMinor}) = 'integer' and ${table.amountMinor} >= ${sql.raw(String(MIN_TRANSACTION_MINOR))} and ${table.amountMinor} <= ${sql.raw(String(MAX_TRANSACTION_MINOR))}`,
    ),
    check(
      "transaction_date_is_iso_day",
      sql`${table.date} glob ${sql.raw(`'${TRANSACTION_DATE_GLOB}'`)}`,
    ),
  ],
);

export const transactionTag = sqliteTable(
  "transaction_tag",
  {
    transactionId: text("transaction_id").notNull(),
    tagId: text("tag_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [
    primaryKey({
      name: "transaction_tag_pk",
      columns: [table.transactionId, table.tagId],
    }),
    foreignKey({
      name: "transaction_tag_workspace_id_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
    }),
    foreignKey({
      name: "transaction_tag_transaction_workspace_fk",
      columns: [table.transactionId, table.workspaceId],
      foreignColumns: [transaction.id, transaction.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "transaction_tag_tag_workspace_fk",
      columns: [table.tagId, table.workspaceId],
      foreignColumns: [tag.id, tag.workspaceId],
    }),
    index("transaction_tag_tag_transaction_idx").on(
      table.tagId,
      table.transactionId,
    ),
  ],
);
