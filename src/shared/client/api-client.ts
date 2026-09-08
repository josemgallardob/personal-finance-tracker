/**
 * Browser transport for the API.
 *
 * Every call the interface makes goes through this module, so the rules that
 * must never vary live in one place: the URL is always relative to the current
 * origin and below {@link API_BASE_PATH}, the session cookie travels only to
 * that same origin, no response is cached, and the outcome is a value instead
 * of a thrown error.
 *
 * The returned union is deliberately wider than "worked or failed". A refused
 * request that carries an {@link ApiErrorDto} is a different situation from a
 * browser that never reached the server, from a response whose body is not the
 * envelope the API promises, and from a request the caller itself aborted. A
 * form can only keep the user's input, show the Spanish copy of the refusal or
 * stay silent on a cancelled reload if it can tell those four apart.
 *
 * The transport never repeats a request. `POST`, `PUT`, `PATCH` and `DELETE`
 * create, replace, rename and remove resources, so a retry hidden inside the
 * client could duplicate a movement the owner entered once; whether an
 * operation may be attempted again is a decision for the caller that knows
 * its semantics.
 */

import type {
  ApiErrorCode,
  ApiErrorDto,
  ApiFieldErrorDto,
} from "../contracts/api";
import { API_ERROR_STATUS } from "../contracts/api";
import type { ApiMethod } from "../contracts/http";
import {
  API_BASE_PATH,
  API_JSON_MEDIA_TYPE,
  REQUEST_ID_HEADER,
} from "../contracts/http";

/** Status of an accepted request that has nothing to represent. */
export const NO_CONTENT_STATUS = 204;

/**
 * The single browser API the client depends on.
 *
 * Tests replace this at the real boundary; everything above it, including
 * envelope parsing and status handling, runs unchanged.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Per-call options a caller may supply. */
export interface ApiRequestOptions {
  /** Cancels the request when the view that started it no longer needs it. */
  readonly signal?: AbortSignal;
}

/** One request, as the transport receives it. */
export interface ApiClientRequest extends ApiRequestOptions {
  readonly method: ApiMethod;
  /** Origin-relative path below `/api/`, query string included. */
  readonly path: string;
  /** Value serialised as the JSON payload; absent when there is no body. */
  readonly body?: unknown;
}

/** Accepted request that carries a representation. */
export interface ApiClientData<TData> {
  readonly ok: true;
  readonly noContent: false;
  readonly status: number;
  readonly requestId: string;
  readonly data: TData;
}

/** Accepted request that answered `204` and therefore has no body. */
export interface ApiClientNoContent {
  readonly ok: true;
  readonly noContent: true;
  readonly status: typeof NO_CONTENT_STATUS;
  readonly requestId: string;
}

/** Accepted request, with or without a representation. */
export type ApiClientSuccess<TData> = ApiClientData<TData> | ApiClientNoContent;

/** The server answered, refused the request and explained why. */
export interface ApiClientApiFailure {
  readonly ok: false;
  readonly reason: "api";
  readonly status: number;
  readonly error: ApiErrorDto;
}

/** The request never produced a response: offline, DNS, TLS or a reset. */
export interface ApiClientNetworkFailure {
  readonly ok: false;
  readonly reason: "network";
}

/**
 * A response arrived but is not the contract.
 *
 * Invalid JSON, a truncated body or an envelope without its `data`, `error` or
 * `requestId` member all land here, because none of them tells the caller
 * whether the operation was applied.
 */
export interface ApiClientInvalidResponseFailure {
  readonly ok: false;
  readonly reason: "invalidResponse";
  readonly status: number;
}

/** The caller aborted the request through its signal. */
export interface ApiClientAbortedFailure {
  readonly ok: false;
  readonly reason: "aborted";
}

/** Every way a request can fail to produce a representation. */
export type ApiClientFailure =
  | ApiClientApiFailure
  | ApiClientNetworkFailure
  | ApiClientInvalidResponseFailure
  | ApiClientAbortedFailure;

/** Outcome of a call: a typed representation, or a distinguishable failure. */
export type ApiClientResult<TData> = ApiClientSuccess<TData> | ApiClientFailure;

/** Transport the resource adapters are written against. */
export interface ApiClient {
  request<TData>(request: ApiClientRequest): Promise<ApiClientResult<TData>>;
  get<TData>(
    path: string,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TData>>;
  post<TData>(
    path: string,
    body: unknown,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TData>>;
  put<TData>(
    path: string,
    body: unknown,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TData>>;
  patch<TData>(
    path: string,
    body: unknown,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TData>>;
  delete<TData>(
    path: string,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TData>>;
}

/** Collaborators of the transport. Tests replace the browser `fetch`. */
export interface ApiClientDeps {
  readonly fetch?: FetchLike;
}

const API_PATH_PREFIX = `${API_BASE_PATH}/`;

/**
 * Returns the relative URL of an endpoint.
 *
 * A path that does not live below `/api/` is a defect in the calling code, not
 * a runtime condition a view could recover from, so it is reported by throwing
 * instead of becoming one more failure the caller has to render.
 */
export function resolveApiPath(path: string): string {
  if (!path.startsWith(API_PATH_PREFIX)) {
    throw new Error(
      `API paths must be same-origin and start with "${API_PATH_PREFIX}".`,
    );
  }

  return path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && value in API_ERROR_STATUS;
}

function readFieldErrors(
  value: unknown,
): readonly ApiFieldErrorDto[] | "invalid" | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return "invalid";
  }

  const details: ApiFieldErrorDto[] = [];

  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.field !== "string" ||
      typeof entry.code !== "string"
    ) {
      return "invalid";
    }

    details.push({
      field: entry.field,
      code: entry.code as ApiFieldErrorDto["code"],
    });
  }

  return details;
}

/**
 * Reads the error envelope of a refused request.
 *
 * The field errors are kept exactly as the server sent them: the code of every
 * rejected field is what lets a form mark that field, so collapsing the list
 * into a single message would lose the only structure a `422` carries.
 */
function readApiError(payload: unknown): ApiErrorDto | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  const error = payload.error;

  if (
    !isApiErrorCode(error.code) ||
    typeof error.message !== "string" ||
    typeof error.requestId !== "string"
  ) {
    return null;
  }

  const details = readFieldErrors(error.details);

  if (details === "invalid") {
    return null;
  }

  const dto: ApiErrorDto = {
    code: error.code,
    message: error.message,
    requestId: error.requestId,
  };

  return details === undefined ? dto : { ...dto, details };
}

interface ParsedEnvelope<TData> {
  readonly data: TData;
  readonly requestId: string;
}

function readDataEnvelope<TData>(
  payload: unknown,
): ParsedEnvelope<TData> | null {
  if (
    !isRecord(payload) ||
    !("data" in payload) ||
    typeof payload.requestId !== "string"
  ) {
    return null;
  }

  return { data: payload.data as TData, requestId: payload.requestId };
}

function invalidResponse(status: number): ApiClientInvalidResponseFailure {
  return { ok: false, reason: "invalidResponse", status };
}

/**
 * Tells whether a rejected request was cancelled rather than broken.
 *
 * The signal is consulted first because it is the caller's own record of what
 * happened; the error name covers an abort raised by a transport that did not
 * receive the signal directly.
 */
function isAbortFailure(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  if (signal?.aborted === true) {
    return true;
  }

  return isRecord(error) && error.name === "AbortError";
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

async function readResponse<TData>(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<ApiClientResult<TData>> {
  if (response.status === NO_CONTENT_STATUS) {
    const requestId = response.headers.get(REQUEST_ID_HEADER);

    if (requestId === null) {
      return invalidResponse(response.status);
    }

    return {
      ok: true,
      noContent: true,
      status: NO_CONTENT_STATUS,
      requestId,
    };
  }

  let text: string;

  try {
    text = await response.text();
  } catch (error) {
    return isAbortFailure(error, signal)
      ? { ok: false, reason: "aborted" }
      : { ok: false, reason: "network" };
  }

  const payload = parseJson(text);

  if (!payload.ok) {
    return invalidResponse(response.status);
  }

  if (!response.ok) {
    const error = readApiError(payload.value);

    return error === null
      ? invalidResponse(response.status)
      : { ok: false, reason: "api", status: response.status, error };
  }

  const envelope = readDataEnvelope<TData>(payload.value);

  if (envelope === null) {
    return invalidResponse(response.status);
  }

  return {
    ok: true,
    noContent: false,
    status: response.status,
    requestId: envelope.requestId,
    data: envelope.data,
  };
}

function buildInit(request: ApiClientRequest): RequestInit {
  const headers: Record<string, string> = { accept: API_JSON_MEDIA_TYPE };
  const init: RequestInit = {
    method: request.method,
    // The cookie of the private installation must reach this origin and no
    // other, and a financial response must never be served from a cache.
    credentials: "same-origin",
    cache: "no-store",
    signal: request.signal,
  };

  if (request.body === undefined) {
    return { ...init, headers };
  }

  headers["content-type"] = API_JSON_MEDIA_TYPE;

  return { ...init, headers, body: JSON.stringify(request.body) };
}

function defaultFetch(input: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

/**
 * Builds the transport.
 *
 * Each call performs exactly one `fetch`. There is no retry, no queue and no
 * shared cache between calls: a repeated request is always a decision the
 * caller made explicitly.
 */
export function createApiClient(deps: ApiClientDeps = {}): ApiClient {
  const fetchImpl = deps.fetch ?? defaultFetch;

  async function request<TData>(
    apiRequest: ApiClientRequest,
  ): Promise<ApiClientResult<TData>> {
    const url = resolveApiPath(apiRequest.path);
    let response: Response;

    try {
      response = await fetchImpl(url, buildInit(apiRequest));
    } catch (error) {
      return isAbortFailure(error, apiRequest.signal)
        ? { ok: false, reason: "aborted" }
        : { ok: false, reason: "network" };
    }

    return readResponse<TData>(response, apiRequest.signal);
  }

  return {
    request,
    get: <TData>(path: string, options?: ApiRequestOptions) =>
      request<TData>({ method: "GET", path, ...options }),
    post: <TData>(path: string, body: unknown, options?: ApiRequestOptions) =>
      request<TData>({ method: "POST", path, body, ...options }),
    put: <TData>(path: string, body: unknown, options?: ApiRequestOptions) =>
      request<TData>({ method: "PUT", path, body, ...options }),
    patch: <TData>(path: string, body: unknown, options?: ApiRequestOptions) =>
      request<TData>({ method: "PATCH", path, body, ...options }),
    delete: <TData>(path: string, options?: ApiRequestOptions) =>
      request<TData>({ method: "DELETE", path, ...options }),
  };
}
