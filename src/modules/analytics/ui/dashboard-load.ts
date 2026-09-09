/**
 * Summary of the selected period together with the catalogs that name it.
 *
 * The two calls travel in parallel and share the abort signal of the view, so a
 * period change cancels both. Categories and tags stay `status: "all"`: an
 * archived classification still names a movement that already exists, and a
 * recent movement must never lose its category label because the catalog was
 * later archived.
 *
 * A `204` from any of the calls is treated as an invalid response. The
 * dashboard cannot paint cards without a summary, it must not silently show a
 * recent movement without the names of its classification, and the series
 * selection is stored per application mode, which the preferences carry.
 */

import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import { createPreferencesApi } from "../../preferences/client/preferences-api";
import type { PreferencesDto } from "../../preferences/contracts/preferences";
import { loadHistoryCatalogs } from "../../transactions/ui/history-load";
import type {
  ApiClient,
  ApiClientResult,
} from "../../../shared/client/api-client";
import { createAnalyticsApi } from "../client/analytics-api";
import type { DashboardSummaryQuery } from "../contracts/http";
import type { DashboardSummaryDto } from "../contracts/summary";

/** Everything one render of the dashboard summary needs. */
export interface DashboardSnapshot {
  readonly summary: DashboardSummaryDto;
  readonly categories: readonly CategoryDto[];
  readonly tags: readonly TagDto[];
  readonly preferences: PreferencesDto;
}

/** Loads the summary of a period plus the catalogs that label its movements. */
export async function loadDashboardSnapshot(
  client: ApiClient,
  signal: AbortSignal,
  query: DashboardSummaryQuery,
): Promise<ApiClientResult<DashboardSnapshot>> {
  const analyticsApi = createAnalyticsApi(client);
  const [summary, catalogs, preferences] = await Promise.all([
    analyticsApi.readSummary(query, { signal }),
    loadHistoryCatalogs(client, signal),
    createPreferencesApi(client).getPreferences({ signal }),
  ]);

  if (!summary.ok) {
    return summary;
  }

  if (!catalogs.ok) {
    return catalogs;
  }

  if (!preferences.ok) {
    return preferences;
  }

  if (summary.noContent || catalogs.noContent || preferences.noContent) {
    return { ok: false, reason: "invalidResponse", status: 204 };
  }

  return {
    ok: true,
    noContent: false,
    status: summary.status,
    requestId: summary.requestId,
    data: {
      summary: summary.data,
      categories: catalogs.data.categories,
      tags: catalogs.data.tags,
      preferences: preferences.data,
    },
  };
}
