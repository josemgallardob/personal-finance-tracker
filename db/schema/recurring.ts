/**
 * Monthly recurrence tables.
 *
 * A rule owns its template, so the movement it was created from is only an
 * origin link. That link and the link of an occurrence to its generated
 * movement are the only references between these tables and `transaction`, both
 * nullable and both `ON DELETE SET NULL`. `transaction` keeps no column
 * pointing back, so no cycle of foreign keys exists between the two directions
 * and deleting a movement never needs a deferred check.
 *
 * `recurring_occurrence` is unique by rule and scheduled day. That single
 * constraint is what makes generation idempotent under a retry or a concurrent
 * run, and it survives the deletion of its movement: the link becomes null, the
 * date stays processed and the rule never regenerates it.
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
  MAX_MONTHLY_DAY,
  MIN_MONTHLY_DAY,
} from "../../src/modules/recurring/domain/recurrence-calendar";
import { INITIAL_TEMPLATE_VERSION } from "../../src/modules/recurring/domain/recurring-rule";
import { TRANSACTION_TYPES } from "../../src/modules/transactions/domain/transaction-type";
import {
  MAX_TRANSACTION_MINOR,
  MIN_TRANSACTION_MINOR,
} from "../../src/shared/domain/money";
import { category, tag } from "./classification";
import { TRANSACTION_DATE_GLOB, transaction } from "./transaction";
import { workspace } from "./workspace";

export const recurringRule = sqliteTable(
  "recurring_rule",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sourceTransactionId: text("source_transaction_id"),
    type: text("type").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    categoryId: text("category_id").notNull(),
    concept: text("concept"),
    note: text("note"),
    monthlyDay: integer("monthly_day").notNull(),
    nextDueDate: text("next_due_date").notNull(),
    templateVersion: integer("template_version").notNull(),
    deactivatedAt: integer("deactivated_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "recurring_rule_workspace_id_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
    }),
    foreignKey({
      name: "recurring_rule_source_transaction_fk",
      columns: [table.sourceTransactionId],
      foreignColumns: [transaction.id],
    }).onDelete("set null"),
    foreignKey({
      name: "recurring_rule_category_workspace_fk",
      columns: [table.categoryId, table.workspaceId],
      foreignColumns: [category.id, category.workspaceId],
    }),
    foreignKey({
      name: "recurring_rule_category_type_fk",
      columns: [table.categoryId, table.type],
      foreignColumns: [category.id, category.type],
    }),
    uniqueIndex("recurring_rule_id_workspace_unique").on(
      table.id,
      table.workspaceId,
    ),
    uniqueIndex("recurring_rule_active_source_unique")
      .on(table.sourceTransactionId)
      .where(sql`${table.deactivatedAt} is null`),
    index("recurring_rule_active_due_idx")
      .on(table.workspaceId, table.nextDueDate)
      .where(sql`${table.deactivatedAt} is null`),
    check(
      "recurring_rule_type_is_supported",
      sql.raw(
        `"recurring_rule"."type" IN (${TRANSACTION_TYPES.map((type) => `'${type}'`).join(", ")})`,
      ),
    ),
    check(
      "recurring_rule_amount_minor_is_accepted",
      sql`typeof(${table.amountMinor}) = 'integer' and ${table.amountMinor} >= ${sql.raw(String(MIN_TRANSACTION_MINOR))} and ${table.amountMinor} <= ${sql.raw(String(MAX_TRANSACTION_MINOR))}`,
    ),
    check(
      "recurring_rule_monthly_day_is_accepted",
      sql`typeof(${table.monthlyDay}) = 'integer' and ${table.monthlyDay} >= ${sql.raw(String(MIN_MONTHLY_DAY))} and ${table.monthlyDay} <= ${sql.raw(String(MAX_MONTHLY_DAY))}`,
    ),
    check(
      "recurring_rule_next_due_date_is_iso_day",
      sql`${table.nextDueDate} glob ${sql.raw(`'${TRANSACTION_DATE_GLOB}'`)}`,
    ),
    check(
      "recurring_rule_template_version_is_accepted",
      sql`typeof(${table.templateVersion}) = 'integer' and ${table.templateVersion} >= ${sql.raw(String(INITIAL_TEMPLATE_VERSION))}`,
    ),
  ],
);

export const recurringRuleTag = sqliteTable(
  "recurring_rule_tag",
  {
    recurringRuleId: text("recurring_rule_id").notNull(),
    tagId: text("tag_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [
    primaryKey({
      name: "recurring_rule_tag_pk",
      columns: [table.recurringRuleId, table.tagId],
    }),
    foreignKey({
      name: "recurring_rule_tag_workspace_id_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
    }),
    foreignKey({
      name: "recurring_rule_tag_rule_workspace_fk",
      columns: [table.recurringRuleId, table.workspaceId],
      foreignColumns: [recurringRule.id, recurringRule.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "recurring_rule_tag_tag_workspace_fk",
      columns: [table.tagId, table.workspaceId],
      foreignColumns: [tag.id, tag.workspaceId],
    }),
    index("recurring_rule_tag_tag_rule_idx").on(
      table.tagId,
      table.recurringRuleId,
    ),
  ],
);

export const recurringOccurrence = sqliteTable(
  "recurring_occurrence",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    recurringRuleId: text("recurring_rule_id").notNull(),
    scheduledFor: text("scheduled_for").notNull(),
    transactionId: text("transaction_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "recurring_occurrence_workspace_id_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspace.id],
    }),
    foreignKey({
      name: "recurring_occurrence_rule_workspace_fk",
      columns: [table.recurringRuleId, table.workspaceId],
      foreignColumns: [recurringRule.id, recurringRule.workspaceId],
    }),
    foreignKey({
      name: "recurring_occurrence_transaction_fk",
      columns: [table.transactionId],
      foreignColumns: [transaction.id],
    }).onDelete("set null"),
    uniqueIndex("recurring_occurrence_rule_scheduled_for_unique").on(
      table.recurringRuleId,
      table.scheduledFor,
    ),
    uniqueIndex("recurring_occurrence_transaction_unique")
      .on(table.transactionId)
      .where(sql`${table.transactionId} is not null`),
    index("recurring_occurrence_workspace_scheduled_for_idx").on(
      table.workspaceId,
      table.scheduledFor,
    ),
    check(
      "recurring_occurrence_scheduled_for_is_iso_day",
      sql`${table.scheduledFor} glob ${sql.raw(`'${TRANSACTION_DATE_GLOB}'`)}`,
    ),
  ],
);
