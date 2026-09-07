/**
 * Server-only resolution of the implicit personal workspace.
 *
 * The identifier is read from the database after initialization. Request
 * handlers must call this instead of accepting a workspace id from the client,
 * and they must not run migrations.
 */

import "server-only";

import {
  APPLICATION_CURRENCY,
  APPLICATION_LOCALE,
  PERSONAL_WORKSPACE_KIND,
} from "../../../../db/schema";
import { APPLICATION_TIME_ZONE } from "../../../shared/domain/clock";
import type { SqliteConnection } from "../../../shared/server/database";

/** Personal workspace and the preferences stored with it. */
export interface PersonalWorkspace {
  readonly id: string;
  readonly kind: typeof PERSONAL_WORKSPACE_KIND;
  readonly locale: typeof APPLICATION_LOCALE;
  readonly currency: typeof APPLICATION_CURRENCY;
  readonly timeZone: typeof APPLICATION_TIME_ZONE;
  readonly createdAt: number;
}

/** Outcome of looking up the implicit workspace. */
export type WorkspaceResolveResult =
  | { readonly ok: true; readonly value: PersonalWorkspace }
  | {
      readonly ok: false;
      readonly error: { readonly code: "workspaceNotFound" };
    };

/** Reads the personal workspace. Does not migrate or create rows. */
export function resolvePersonalWorkspace(
  connection: SqliteConnection,
): WorkspaceResolveResult {
  let row:
    | {
        id: string;
        kind: string;
        createdAt: number;
        locale: string;
        currency: string;
        timeZone: string;
      }
    | undefined;

  try {
    row = connection.sqlite
      .prepare(
        `SELECT
           workspace.id AS id,
           workspace.kind AS kind,
           workspace.created_at AS createdAt,
           preference.locale AS locale,
           preference.currency AS currency,
           preference.time_zone AS timeZone
         FROM workspace
         INNER JOIN preference ON preference.workspace_id = workspace.id
         WHERE workspace.kind = ?`,
      )
      .get(PERSONAL_WORKSPACE_KIND) as typeof row;
  } catch {
    return { ok: false, error: { code: "workspaceNotFound" } };
  }

  if (!row) {
    return { ok: false, error: { code: "workspaceNotFound" } };
  }

  return {
    ok: true,
    value: {
      id: row.id,
      kind: PERSONAL_WORKSPACE_KIND,
      locale: APPLICATION_LOCALE,
      currency: APPLICATION_CURRENCY,
      timeZone: APPLICATION_TIME_ZONE,
      createdAt: row.createdAt,
    },
  };
}
