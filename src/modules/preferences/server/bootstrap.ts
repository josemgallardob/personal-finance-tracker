/**
 * Idempotent bootstrap of the implicit personal workspace.
 *
 * This writes the single personal space and its fixed preferences. It is part
 * of explicit initialization, not of a request handler: calling it twice or
 * after a restart leaves the existing row untouched.
 */

import "server-only";

import { randomUUID } from "node:crypto";

import {
  APPLICATION_CURRENCY,
  APPLICATION_LOCALE,
  PERSONAL_WORKSPACE_KIND,
} from "../../../../db/schema";
import { APPLICATION_TIME_ZONE } from "../../../shared/domain/clock";
import type { SqliteConnection } from "../../../shared/server/database";

/** Outcome of creating or reusing the personal workspace. */
export type BootstrapResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly workspaceId: string;
        readonly created: boolean;
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "bootstrapFailed";
        readonly cause: string;
      };
    };

/**
 * Ensures the personal workspace and its preferences exist.
 *
 * `now` supplies technical timestamps so tests can stay deterministic without
 * patching the bootstrap rules.
 */
export function bootstrapPersonalWorkspace(
  connection: SqliteConnection,
  now: () => number = () => Date.now(),
): BootstrapResult {
  let existing: { id: string } | undefined;

  try {
    existing = connection.sqlite
      .prepare("SELECT id FROM workspace WHERE kind = ?")
      .get(PERSONAL_WORKSPACE_KIND) as { id: string } | undefined;
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "bootstrapFailed",
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }

  if (existing) {
    return { ok: true, value: { workspaceId: existing.id, created: false } };
  }

  const workspaceId = randomUUID();
  const createdAt = now();

  try {
    const insert = connection.sqlite.transaction(() => {
      connection.sqlite
        .prepare(
          "INSERT INTO workspace (id, kind, created_at) VALUES (?, ?, ?)",
        )
        .run(workspaceId, PERSONAL_WORKSPACE_KIND, createdAt);
      connection.sqlite
        .prepare(
          `INSERT INTO preference (
            workspace_id, locale, currency, time_zone, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          workspaceId,
          APPLICATION_LOCALE,
          APPLICATION_CURRENCY,
          APPLICATION_TIME_ZONE,
          createdAt,
          createdAt,
        );
    });

    insert();
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "bootstrapFailed",
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }

  return { ok: true, value: { workspaceId, created: true } };
}
