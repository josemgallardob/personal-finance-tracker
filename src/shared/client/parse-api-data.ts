/**
 * Response-body validation against a public Zod contract.
 *
 * The transport already distinguishes a refused request, a network failure, an
 * aborted call and a body that is not an envelope. This helper is the next
 * gate: an envelope whose `data` is not the documented DTO is treated as an
 * invalid response, so a view never renders a movement, category or preference
 * that the contract did not describe.
 */

import type { z } from "zod";

import type { ApiClientResult } from "./api-client";

/**
 * Keeps a successful representation only when it matches `schema`.
 *
 * Failures and `204` answers pass through unchanged: there is no payload to
 * validate, and the caller already knows how to tell those outcomes apart.
 */
export function parseApiData<TData>(
  result: ApiClientResult<unknown>,
  schema: z.ZodType<TData>,
): ApiClientResult<TData> {
  if (!result.ok || result.noContent) {
    return result;
  }

  const parsed = schema.safeParse(result.data);

  if (!parsed.success) {
    return { ok: false, reason: "invalidResponse", status: result.status };
  }

  return { ...result, data: parsed.data };
}
