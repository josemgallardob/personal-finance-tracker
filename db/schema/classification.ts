/**
 * Category and tag tables for workspace-scoped classification.
 *
 * Active normalized names are unique within their documented scope. Archived
 * rows keep their history and may reuse a name after the active collision is
 * gone. Type on a category is immutable in the MVP; the column is still
 * constrained here so a later mutation cannot store an unsupported value.
 */

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { TRANSACTION_TYPES } from "../../src/modules/transactions/domain/transaction-type";
import { workspace } from "./workspace";

const typeCheckSql = (tableName: string) =>
  sql.raw(
    `"${tableName}"."type" IN (${TRANSACTION_TYPES.map((type) => `'${type}'`).join(", ")})`,
  );

export const category = sqliteTable(
  "category",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    type: text("type").notNull(),
    sortOrder: integer("sort_order").notNull(),
    archivedAt: integer("archived_at"),
  },
  (table) => [
    foreignKey({
      name: "category_workspace_id_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
    }),
    uniqueIndex("category_id_workspace_unique").on(table.id, table.workspaceId),
    uniqueIndex("category_id_type_unique").on(table.id, table.type),
    uniqueIndex("category_active_normalized_name_unique")
      .on(table.workspaceId, table.type, table.normalizedName)
      .where(sql`${table.archivedAt} is null`),
    index("category_normalized_name_idx").on(
      table.workspaceId,
      table.type,
      table.normalizedName,
    ),
    check("category_type_is_supported", typeCheckSql("category")),
    check("category_sort_order_is_non_negative", sql`${table.sortOrder} >= 0`),
  ],
);

export const tag = sqliteTable(
  "tag",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    archivedAt: integer("archived_at"),
  },
  (table) => [
    foreignKey({
      name: "tag_workspace_id_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
    }),
    uniqueIndex("tag_id_workspace_unique").on(table.id, table.workspaceId),
    uniqueIndex("tag_active_normalized_name_unique")
      .on(table.workspaceId, table.normalizedName)
      .where(sql`${table.archivedAt} is null`),
    index("tag_normalized_name_idx").on(
      table.workspaceId,
      table.normalizedName,
    ),
  ],
);
