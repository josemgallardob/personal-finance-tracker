/**
 * Browser adapter for the preferences endpoint.
 *
 * GET /api/preferences is a read of the fixed personal configuration. There is
 * no mutation method: locale, currency and time zone are not client-writable.
 * The returned representation is validated against the public
 * Zod contract.
 */

import type {
  ApiClient,
  ApiClientResult,
  ApiRequestOptions,
} from "../../../shared/client/api-client";
import { parseApiData } from "../../../shared/client/parse-api-data";
import { apiPath } from "../../../shared/client/query";
import { preferencesDtoSchema } from "../contracts/http";
import type { PreferencesDto } from "../contracts/preferences";

/** Preference operations of the browser API. */
export interface PreferencesApi {
  getPreferences(
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<PreferencesDto>>;
}

/** Builds the preferences adapter against a transport. */
export function createPreferencesApi(client: ApiClient): PreferencesApi {
  return {
    async getPreferences(options) {
      return parseApiData(
        await client.get(apiPath("/api/preferences"), options),
        preferencesDtoSchema,
      );
    },
  };
}
