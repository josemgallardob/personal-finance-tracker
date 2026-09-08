/**
 * Bounded JSON request reading.
 *
 * A request body is untrusted and unbounded by default, so it is never handed
 * to `request.json()`. This module enforces the declared media type, refuses an
 * announced or streamed body larger than the accepted budget before it is kept
 * in memory, and reports a parse failure as a status instead of a thrown
 * `SyntaxError`. The parser returns `unknown`: shaping the value is the job of
 * the strict schema layer, not of the reader.
 */

import "server-only";

import { apiFailure, accepted, refused, type ApiResult } from "./failure";

/**
 * Largest accepted request body, in bytes.
 *
 * The largest legitimate payload is a movement with a 2000-character note, a
 * 200-character concept and twenty tags. 64 KiB leaves ample room for that
 * while keeping a hostile body from being buffered.
 */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

const JSON_MEDIA_TYPE = "application/json";

function mediaType(header: string | null): string | null {
  if (header === null) {
    return null;
  }

  const [essence] = header.split(";");

  return essence.trim().toLowerCase();
}

function declaredLength(header: string | null): number | null | "invalid" {
  if (header === null) {
    return null;
  }

  const trimmed = header.trim();

  if (!/^\d+$/.test(trimmed)) {
    return "invalid";
  }

  return Number.parseInt(trimmed, 10);
}

async function readBoundedBytes(
  request: Request,
): Promise<ApiResult<Uint8Array>> {
  const body = request.body;

  if (body === null) {
    return accepted(new Uint8Array(0));
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel();
      return refused(apiFailure("payloadTooLarge"));
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return accepted(merged);
}

/**
 * Reads, bounds and parses the JSON body of a request.
 *
 * The order of the checks is part of the policy: a wrong media type or an
 * oversized announcement is refused before any byte is buffered, so a hostile
 * client cannot make the server hold a large body just to be told the type was
 * wrong afterwards.
 */
export async function readJsonBody(
  request: Request,
): Promise<ApiResult<unknown>> {
  if (mediaType(request.headers.get("content-type")) !== JSON_MEDIA_TYPE) {
    return refused(apiFailure("badRequest"));
  }

  const announced = declaredLength(request.headers.get("content-length"));

  if (announced === "invalid") {
    return refused(apiFailure("badRequest"));
  }

  if (announced !== null && announced > MAX_REQUEST_BODY_BYTES) {
    return refused(apiFailure("payloadTooLarge"));
  }

  const bytes = await readBoundedBytes(request);

  if (!bytes.ok) {
    return bytes;
  }

  if (bytes.value.byteLength === 0) {
    return refused(apiFailure("badRequest"));
  }

  let text: string;

  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.value);
  } catch {
    return refused(apiFailure("badRequest"));
  }

  try {
    return accepted(JSON.parse(text) as unknown);
  } catch {
    return refused(apiFailure("badRequest"));
  }
}
