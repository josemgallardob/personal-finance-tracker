/**
 * Explicit replacement endpoint for the isolated fictitious dataset.
 *
 * The common API pipeline resolves the closed-set cookie before this handler
 * runs. A personal request therefore never receives the demo connection, and
 * the synchronous SQLite replacement transaction cannot expose a half-seeded
 * state to another request in this process.
 */

import "server-only";

import { z } from "zod";

import { seedDemoDatabase } from "../application/demo/seed-demo";
import { DEMO_APPLICATION_MODE } from "../contracts";
import {
  accepted,
  apiFailure,
  refused,
} from "../../../shared/server/http/failure";
import {
  createApiHandler,
  type ApiHandler,
} from "../../../shared/server/http/handler";
import {
  createServerComposition,
  type ServerCompositionDeps,
} from "../../../shared/server/composition";

const resetDemoBodySchema = z.strictObject({
  confirmed: z.literal(true),
});

export interface ResetDemoDto {
  readonly transactionCount: number;
  readonly recurringRuleCount: number;
}

/** POST /api/demo/reset. It is intentionally unavailable in personal mode. */
export function createPostDemoResetHandler(
  deps: ServerCompositionDeps = {},
): ApiHandler {
  const composition = createServerComposition(deps);

  return createApiHandler<{ confirmed: true }, undefined, ResetDemoDto>(
    {
      bodySchema: resetDemoBodySchema,
      handle(context) {
        if (context.mode !== DEMO_APPLICATION_MODE) {
          return refused(apiFailure("forbidden"));
        }

        const seeded = seedDemoDatabase(context.connection, composition.clock);

        if (!seeded.ok) {
          return refused(apiFailure("serviceUnavailable"));
        }

        return accepted({
          status: 200,
          data: seeded.value,
        });
      },
    },
    composition.handlerDeps,
  );
}
