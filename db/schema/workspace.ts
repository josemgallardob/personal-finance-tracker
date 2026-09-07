/**
 * Workspace and preference tables for the implicit personal space.
 *
 * The MVP stores one personal workspace per database file. Preferences are
 * fixed to Spanish, EUR and Europe/Madrid; later areas add more tables, not
 * a second workspace in this file.
 */

import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { APPLICATION_TIME_ZONE } from "../../src/shared/domain/clock";

/** Kind of the single implicit workspace created at bootstrap. */
export const PERSONAL_WORKSPACE_KIND = "personal";

/** Locale stored for the personal workspace. */
export const APPLICATION_LOCALE = "es-ES";

/** Currency stored for the personal workspace. */
export const APPLICATION_CURRENCY = "EUR";

export const workspace = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_kind_unique").on(table.kind),
    check(
      "workspace_kind_is_personal",
      sql`${table.kind} = ${sql.raw(`'${PERSONAL_WORKSPACE_KIND}'`)}`,
    ),
  ],
);

export const preference = sqliteTable(
  "preference",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspace.id),
    locale: text("locale").notNull(),
    currency: text("currency").notNull(),
    timeZone: text("time_zone").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "preference_locale_is_es_es",
      sql`${table.locale} = ${sql.raw(`'${APPLICATION_LOCALE}'`)}`,
    ),
    check(
      "preference_currency_is_eur",
      sql`${table.currency} = ${sql.raw(`'${APPLICATION_CURRENCY}'`)}`,
    ),
    check(
      "preference_time_zone_is_madrid",
      sql`${table.timeZone} = ${sql.raw(`'${APPLICATION_TIME_ZONE}'`)}`,
    ),
  ],
);
