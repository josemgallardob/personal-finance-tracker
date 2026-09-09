"use client";

/**
 * Browser operations for changing and resetting the isolated demo session.
 *
 * The server owns the cookie and the database paths. The browser can only ask
 * for one of the two documented modes or confirm a reset of its current demo
 * session.
 */

import { z } from "zod";

import type {
  ApiClient,
  ApiClientResult,
} from "../../../shared/client/api-client";
import { parseApiData } from "../../../shared/client/parse-api-data";
import { apiPath } from "../../../shared/client/query";
import {
  DEMO_APPLICATION_MODE,
  PERSONAL_APPLICATION_MODE,
  type ApplicationMode,
} from "../contracts/preferences";

const demoSessionSchema = z.strictObject({
  mode: z.union([
    z.literal(PERSONAL_APPLICATION_MODE),
    z.literal(DEMO_APPLICATION_MODE),
  ]),
});

const demoResetSchema = z.strictObject({
  transactionCount: z.number().int().nonnegative(),
  recurringRuleCount: z.number().int().nonnegative(),
});

export interface DemoApi {
  setMode(
    mode: ApplicationMode,
  ): Promise<ApiClientResult<{ readonly mode: ApplicationMode }>>;
  reset(): Promise<
    ApiClientResult<{
      readonly transactionCount: number;
      readonly recurringRuleCount: number;
    }>
  >;
}

/** Builds the browser adapter for the two isolated demo mutations. */
export function createDemoApi(client: ApiClient): DemoApi {
  return {
    async setMode(mode) {
      return parseApiData(
        await client.post(apiPath("/api/demo/session"), { mode }),
        demoSessionSchema,
      );
    },
    async reset() {
      return parseApiData(
        await client.post(apiPath("/api/demo/reset"), { confirmed: true }),
        demoResetSchema,
      );
    },
  };
}
