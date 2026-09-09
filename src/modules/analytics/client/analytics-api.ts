/**
 * Browser adapters for the dashboard analytics endpoints.
 *
 * Each method builds the documented URL and validates the returned
 * representation against the public Zod contract, so a dashboard never paints a
 * figure the contract did not describe.
 *
 * Only the summary accepts a selection. The evolution series and the monthly
 * averages have windows that are rules of the calendar and of the stored
 * history, so their requests carry no parameter at all: what the interface
 * draws never decides what the server sums.
 */

import type {
  ApiClient,
  ApiClientResult,
  ApiRequestOptions,
} from "../../../shared/client/api-client";
import { parseApiData } from "../../../shared/client/parse-api-data";
import { apiPath, type ApiQueryParams } from "../../../shared/client/query";
import {
  dashboardSummaryDtoSchema,
  monthlyAveragesDtoSchema,
  monthlyEvolutionDtoSchema,
  type DashboardSummaryQuery,
} from "../contracts/http";
import type { DashboardSummaryDto } from "../contracts/summary";
import type { MonthlyEvolutionDto } from "../contracts/evolution";
import type { MonthlyAveragesDto } from "../contracts/averages";

/** Dashboard read operations of the browser API. */
export interface AnalyticsApi {
  readSummary(
    query: DashboardSummaryQuery,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<DashboardSummaryDto>>;
  readEvolution(
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<MonthlyEvolutionDto>>;
  readAverages(
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<MonthlyAveragesDto>>;
}

/**
 * Query parameters of a summary request.
 *
 * The months of a custom range are the only optional parameters, and they are
 * omitted for every preset: sending them would describe a range the server does
 * not use and the request would be refused.
 */
export function summaryQueryParams(
  query: DashboardSummaryQuery,
): ApiQueryParams {
  return {
    period: query.period,
    from: query.from,
    to: query.to,
  };
}

/** Builds the analytics adapters against a transport. */
export function createAnalyticsApi(client: ApiClient): AnalyticsApi {
  return {
    async readSummary(query, options) {
      return parseApiData(
        await client.get(
          apiPath("/api/analytics/summary", summaryQueryParams(query)),
          options,
        ),
        dashboardSummaryDtoSchema,
      );
    },

    async readEvolution(options) {
      return parseApiData(
        await client.get(apiPath("/api/analytics/evolution"), options),
        monthlyEvolutionDtoSchema,
      );
    },

    async readAverages(options) {
      return parseApiData(
        await client.get(apiPath("/api/analytics/averages"), options),
        monthlyAveragesDtoSchema,
      );
    },
  };
}
