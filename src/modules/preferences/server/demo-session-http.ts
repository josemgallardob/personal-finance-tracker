/**
 * Session selection endpoint for the isolated demonstration.
 *
 * This endpoint intentionally does not open, migrate, seed, copy or delete a
 * database. It only validates the requested closed-set mode and writes the
 * session cookie that later request composition consumes.
 */

import "server-only";

import { z } from "zod";

import {
  DEMO_APPLICATION_MODE,
  PERSONAL_APPLICATION_MODE,
  type ApplicationMode,
} from "../contracts";
import { loadAppConfig, type EnvSource } from "../../../shared/server/config";
import { apiFailure } from "../../../shared/server/http/failure";
import { readJsonBody } from "../../../shared/server/http/json-body";
import { checkRequestOrigin } from "../../../shared/server/http/origin";
import { resolveRequestId } from "../../../shared/server/http/request-id";
import {
  dataResponse,
  errorResponse,
} from "../../../shared/server/http/responses";
import { parseRequestPayload } from "../../../shared/server/http/schema";
import { serializeApplicationModeCookie } from "./mode";

const sessionBodySchema = z.strictObject({
  mode: z.union([
    z.literal(PERSONAL_APPLICATION_MODE),
    z.literal(DEMO_APPLICATION_MODE),
  ]),
});

/** Response returned after changing only the selected session mode. */
export interface DemoSessionDto {
  readonly mode: ApplicationMode;
}

/** Dependencies that make the session boundary deterministic in tests. */
export interface DemoSessionHttpDeps {
  readonly env?: EnvSource;
  readonly createRequestId?: () => string;
}

/** POST /api/demo/session. */
export function createPostDemoSessionHandler(
  deps: DemoSessionHttpDeps = {},
): (request: Request) => Promise<Response> {
  const env = deps.env ?? process.env;

  return async function postDemoSession(request: Request): Promise<Response> {
    const requestId = resolveRequestId(request.headers, deps.createRequestId);
    const config = loadAppConfig(env);

    if (!config.ok) {
      return errorResponse(apiFailure("serviceUnavailable"), requestId);
    }

    const originFailure = checkRequestOrigin(request, config.value.appUrl);

    if (originFailure !== null) {
      return errorResponse(originFailure, requestId);
    }

    const payload = await readJsonBody(request);

    if (!payload.ok) {
      return errorResponse(payload.failure, requestId);
    }

    const body = parseRequestPayload(sessionBodySchema, payload.value);

    if (!body.ok) {
      return errorResponse(body.failure, requestId);
    }

    const response = dataResponse<DemoSessionDto>(
      200,
      { mode: body.value.mode },
      requestId,
    );
    response.headers.set(
      "set-cookie",
      serializeApplicationModeCookie(body.value.mode, {
        secure: new URL(config.value.appUrl).protocol === "https:",
      }),
    );
    return response;
  };
}
