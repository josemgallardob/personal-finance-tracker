/**
 * Public HTTP contract shared by the server handlers and the browser client.
 *
 * Every endpoint answers with exactly one of two envelopes: a data envelope
 * that carries the successful representation, or an error envelope that
 * carries a single {@link ApiErrorDto}. The envelope is the only shape the
 * client has to understand, so a caller never has to guess whether a body is a
 * payload, a bare error string or an empty response.
 *
 * The module is deliberately free of Node and Next imports: the same types
 * describe the response on the server and the parsed body on the client.
 */

import type { DomainErrorCode } from "../domain/errors";

/** Stable machine-readable reason why a request was refused. */
export type ApiErrorCode =
  | "badRequest"
  | "forbidden"
  | "notFound"
  | "conflict"
  | "payloadTooLarge"
  | "validationFailed"
  | "internalError"
  | "serviceUnavailable";

/** HTTP status codes the API is allowed to answer with for a refusal. */
export type ApiErrorStatus = 400 | 403 | 404 | 409 | 413 | 422 | 500 | 503;

/** Reason a request was rejected before it reached a domain contract. */
export type ApiSchemaErrorCode =
  | "required"
  | "invalidType"
  | "invalidValue"
  | "invalidFormat"
  | "tooBig"
  | "tooSmall"
  | "unknownField"
  | "invalid";

/**
 * Stable reason why one field of a request was rejected.
 *
 * Shape errors use the schema vocabulary; business refusals keep the domain
 * code unchanged, so a client can render the precise Spanish message a rule
 * deserves instead of a single generic sentence for every refusal.
 */
export type ApiFieldErrorCode = ApiSchemaErrorCode | DomainErrorCode;

/**
 * One rejected field.
 *
 * `field` is the dotted path of the offending property inside the request, and
 * never the value that was sent. Echoing the value back would put a concept, a
 * note or an amount into an error body and, through it, into a client log.
 */
export interface ApiFieldErrorDto {
  readonly field: string;
  readonly code: ApiFieldErrorCode;
}

/**
 * Error representation returned by every refused request.
 *
 * `code` is the English identifier a client branches on. `message` is Spanish
 * user-visible copy and is intentionally generic: it describes the class of
 * problem and never quotes the submitted payload. `requestId` correlates the
 * response with the single sanitized server log line for the same request.
 */
export interface ApiErrorDto {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly requestId: string;
  readonly details?: readonly ApiFieldErrorDto[];
}

/** Envelope of an accepted request. */
export interface ApiDataEnvelope<TData> {
  readonly data: TData;
  readonly requestId: string;
}

/** Envelope of a refused request. */
export interface ApiErrorEnvelope {
  readonly error: ApiErrorDto;
}

/** Either envelope, as a client sees it before inspecting the status. */
export type ApiEnvelope<TData> = ApiDataEnvelope<TData> | ApiErrorEnvelope;

/** Status that {@link ApiErrorCode} always maps to. */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, ApiErrorStatus>> =
  Object.freeze({
    badRequest: 400,
    forbidden: 403,
    notFound: 404,
    conflict: 409,
    payloadTooLarge: 413,
    validationFailed: 422,
    internalError: 500,
    serviceUnavailable: 503,
  });

/**
 * Spanish user-visible copy of each error code.
 *
 * The copy is generic on purpose. A message that repeated the rejected value
 * would leak financial data into a body the client may render or store.
 */
export const API_ERROR_MESSAGE: Readonly<Record<ApiErrorCode, string>> =
  Object.freeze({
    badRequest: "La solicitud no tiene un formato válido.",
    forbidden: "El origen de la solicitud no está permitido.",
    notFound: "El recurso solicitado no existe.",
    conflict: "El estado actual del recurso no permite esta operación.",
    payloadTooLarge: "El contenido de la solicitud es demasiado grande.",
    validationFailed: "Los datos enviados no son válidos.",
    internalError: "Se ha producido un error inesperado.",
    serviceUnavailable: "El servicio no está disponible en este momento.",
  });

/** Tells whether a parsed body is the error envelope. */
export function isApiErrorEnvelope<TData>(
  envelope: ApiEnvelope<TData>,
): envelope is ApiErrorEnvelope {
  return "error" in envelope;
}
