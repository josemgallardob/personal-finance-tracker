/**
 * Request pipeline shared by every API endpoint.
 *
 * An endpoint supplies the schemas of what it accepts and the work it performs
 * on an already validated request. Everything a route must not get wrong is
 * decided here and only here: the correlation identifier, the origin policy for
 * mutations, the bounded body, the strict parsing, the server-derived
 * workspace, the deterministic status of a refusal, the sanitized log line and
 * the `no-store` envelope.
 *
 * The order of the stages is the policy. A foreign origin is refused before a
 * single body byte is read, and the workspace is resolved from the database
 * after validation, so no request can ever influence which workspace it reads
 * or writes.
 */

import "server-only";

import type { z } from "zod";

import type { PersonalWorkspace } from "../../../modules/preferences/server/workspace";
import { resolvePersonalWorkspace } from "../../../modules/preferences/server/workspace";
import type { ApiErrorCode } from "../../contracts/api";
import type { EnvSource } from "../config";
import { loadAppConfig } from "../config";
import type { DatabaseResult, SqliteConnection } from "../database";
import { getSqliteConnection } from "../database";
import { DATABASE_ERROR_API_CODE } from "./domain-status";
import {
  apiFailure,
  accepted,
  refused,
  type ApiFailure,
  type ApiResult,
} from "./failure";
import { readJsonBody } from "./json-body";
import {
  consoleApiLogger,
  describeFailureType,
  logRoute,
  type ApiLogEntry,
  type ApiLogger,
} from "./logging";
import { checkRequestOrigin } from "./origin";
import { parseSearchParams } from "./query";
import { resolveRequestId } from "./request-id";
import { dataResponse, errorResponse, noContentResponse } from "./responses";
import { parseRequestPayload } from "./schema";

/** Status of an accepted mutation that has nothing to represent. */
export const NO_CONTENT_STATUS = 204;

/** Validated request an endpoint receives. */
export interface ApiRequestContext<TBody, TQuery> {
  readonly request: Request;
  readonly url: URL;
  readonly requestId: string;
  /** Identifier read from the database, never from the request. */
  readonly workspaceId: string;
  readonly workspace: PersonalWorkspace;
  readonly connection: SqliteConnection;
  readonly body: TBody;
  readonly query: TQuery;
}

/** Representation an endpoint accepted, with the status it answers. */
export interface ApiSuccess<TData> {
  readonly status: number;
  readonly data: TData;
}

/** What an endpoint declares and does. */
export interface ApiHandlerDefinition<TBody, TQuery, TData> {
  readonly bodySchema?: z.ZodType<TBody>;
  readonly querySchema?: z.ZodType<TQuery>;
  handle(
    context: ApiRequestContext<TBody, TQuery>,
  ): ApiResult<ApiSuccess<TData>> | Promise<ApiResult<ApiSuccess<TData>>>;
}

/** Collaborators of the pipeline. Tests replace them with real fixtures. */
export interface ApiHandlerDeps {
  readonly env?: EnvSource;
  readonly openConnection?: (
    source: EnvSource,
  ) => DatabaseResult<SqliteConnection>;
  readonly logger?: ApiLogger;
  readonly now?: () => number;
  readonly createRequestId?: () => string;
}

/** Route entry point: a request in, a response out. */
export type ApiHandler = (request: Request) => Promise<Response>;

interface PipelineStages<TBody, TQuery> {
  readonly body: TBody;
  readonly query: TQuery;
  readonly connection: SqliteConnection;
  readonly workspace: PersonalWorkspace;
}

async function resolveStages<TBody, TQuery>(
  request: Request,
  url: URL,
  definition: ApiHandlerDefinition<TBody, TQuery, unknown>,
  env: EnvSource,
  openConnection: (source: EnvSource) => DatabaseResult<SqliteConnection>,
): Promise<ApiResult<PipelineStages<TBody, TQuery>>> {
  const config = loadAppConfig(env);

  if (!config.ok) {
    return refused(apiFailure("serviceUnavailable"));
  }

  const originFailure = checkRequestOrigin(request, config.value.appUrl);

  if (originFailure !== null) {
    return refused(originFailure);
  }

  const query = resolveQuery(definition, url);

  if (!query.ok) {
    return refused(query.failure);
  }

  const body = await resolveBody(definition, request);

  if (!body.ok) {
    return refused(body.failure);
  }

  const opened = openConnection(env);

  if (!opened.ok) {
    return refused(apiFailure(DATABASE_ERROR_API_CODE[opened.error.code]));
  }

  const workspace = resolvePersonalWorkspace(opened.value);

  if (!workspace.ok) {
    return refused(apiFailure("serviceUnavailable"));
  }

  return accepted({
    body: body.value,
    query: query.value,
    connection: opened.value,
    workspace: workspace.value,
  });
}

function resolveQuery<TBody, TQuery>(
  definition: ApiHandlerDefinition<TBody, TQuery, unknown>,
  url: URL,
): ApiResult<TQuery> {
  const schema = definition.querySchema;

  if (schema === undefined) {
    return accepted(undefined as TQuery);
  }

  return parseSearchParams(schema, url.searchParams);
}

async function resolveBody<TBody, TQuery>(
  definition: ApiHandlerDefinition<TBody, TQuery, unknown>,
  request: Request,
): Promise<ApiResult<TBody>> {
  const schema = definition.bodySchema;

  if (schema === undefined) {
    return accepted(undefined as TBody);
  }

  const payload = await readJsonBody(request);

  if (!payload.ok) {
    return refused(payload.failure);
  }

  return parseRequestPayload(schema, payload.value);
}

function successResponse<TData>(
  success: ApiSuccess<TData>,
  requestId: string,
): Response {
  if (success.status === NO_CONTENT_STATUS) {
    return noContentResponse(requestId);
  }

  return dataResponse(success.status, success.data, requestId);
}

/**
 * Builds the route entry point for one endpoint.
 *
 * The returned handler never throws: an unexpected failure inside the endpoint
 * is answered as `500` and recorded by its class name only, because a driver
 * message can quote the row that failed.
 */
export function createApiHandler<TBody, TQuery, TData>(
  definition: ApiHandlerDefinition<TBody, TQuery, TData>,
  deps: ApiHandlerDeps = {},
): ApiHandler {
  const env = deps.env ?? process.env;
  const openConnection = deps.openConnection ?? getSqliteConnection;
  const logger = deps.logger ?? consoleApiLogger;
  const now = deps.now ?? Date.now;

  return async function handleRequest(request: Request): Promise<Response> {
    const startedAt = now();
    const requestId = resolveRequestId(request.headers, deps.createRequestId);
    const url = new URL(request.url);

    let failure: ApiFailure | undefined;
    let failureType: string | undefined;
    let response: Response;

    try {
      const stages = await resolveStages(
        request,
        url,
        definition,
        env,
        openConnection,
      );

      if (stages.ok) {
        const outcome = await definition.handle({
          request,
          url,
          requestId,
          workspaceId: stages.value.workspace.id,
          workspace: stages.value.workspace,
          connection: stages.value.connection,
          body: stages.value.body,
          query: stages.value.query,
        });

        if (outcome.ok) {
          response = successResponse(outcome.value, requestId);
        } else {
          failure = outcome.failure;
          response = errorResponse(outcome.failure, requestId);
        }
      } else {
        failure = stages.failure;
        response = errorResponse(stages.failure, requestId);
      }
    } catch (cause) {
      failure = apiFailure("internalError");
      failureType = describeFailureType(cause);
      response = errorResponse(failure, requestId);
    }

    logger(
      buildLogEntry(
        request.method,
        logRoute(url),
        requestId,
        response.status,
        now() - startedAt,
        failure,
        failureType,
      ),
    );

    return response;
  };
}

function buildLogEntry(
  method: string,
  route: string,
  requestId: string,
  status: number,
  durationMs: number,
  failure: ApiFailure | undefined,
  failureType: string | undefined,
): ApiLogEntry {
  const entry: {
    requestId: string;
    method: string;
    route: string;
    status: number;
    durationMs: number;
    errorCode?: ApiErrorCode;
    fieldErrorCount?: number;
    failureType?: string;
  } = { requestId, method, route, status, durationMs };

  if (failure !== undefined) {
    entry.errorCode = failure.code;
    entry.fieldErrorCount = failure.details?.length ?? 0;
  }

  if (failureType !== undefined) {
    entry.failureType = failureType;
  }

  return entry;
}
