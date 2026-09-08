/**
 * Dashboard analytics HTTP handlers.
 *
 * Three reads: the selected period with its comparison and breakdowns, the
 * monthly evolution and the monthly averages. Each handler is a factory so
 * tests inject the same environment, connection, clock and log sink the
 * composition already uses, while the route files call the factory with process
 * defaults.
 *
 * Every response is composed inside one read snapshot of the real SQLite file,
 * so all the figures of a single response observe the same data. The three
 * windows stay independent: the period of the summary never shapes the
 * evolution series or the average divisor, and no endpoint accepts a series
 * selection, because what the interface draws never decides what the server
 * sums.
 */

import "server-only";

import { accepted } from "../../../shared/server/http/failure";
import {
  createApiHandler,
  type ApiHandler,
} from "../../../shared/server/http/handler";
import {
  createServerComposition,
  type ServerCompositionDeps,
} from "../../../shared/server/composition";
import type { SqliteConnection } from "../../../shared/server/database";
import type { Clock } from "../../../shared/domain/clock";
import {
  createDashboardAnalytics,
  type DashboardAnalytics,
} from "../application/dashboard-analytics";
import {
  toDashboardSummaryDto,
  toMonthlyAveragesDto,
  toMonthlyEvolutionDto,
  type DashboardSummaryDto,
  type MonthlyAveragesDto,
  type MonthlyEvolutionDto,
} from "../contracts";
import { sqliteAnalyticsRepository } from "../infrastructure/sqlite-analytics-repository";
import { sqliteAnalyticsSnapshotRunner } from "../infrastructure/sqlite-unit-of-work";
import {
  analyticsSummaryQuerySchema,
  analyticsWindowQuerySchema,
  fromAnalytics,
  resolveDashboardPeriod,
  type AnalyticsSummaryQuery,
  type AnalyticsWindowQuery,
} from "./http";

/** Collaborators of the analytics handlers. The clock is a test seam. */
export type AnalyticsHttpDeps = ServerCompositionDeps;

function dashboardAnalytics(
  connection: SqliteConnection,
  clock: Clock,
): DashboardAnalytics {
  return createDashboardAnalytics({
    analytics: sqliteAnalyticsRepository,
    clock,
    snapshots: sqliteAnalyticsSnapshotRunner(connection),
  });
}

/** GET /api/analytics/summary. */
export function createGetAnalyticsSummaryHandler(
  deps: AnalyticsHttpDeps = {},
): ApiHandler {
  const composition = createServerComposition(deps);

  return createApiHandler<
    undefined,
    AnalyticsSummaryQuery,
    DashboardSummaryDto
  >(
    {
      querySchema: analyticsSummaryQuerySchema,
      handle(context) {
        const period = resolveDashboardPeriod(context.query);

        if (!period.ok) {
          return period;
        }

        const summary = fromAnalytics(
          dashboardAnalytics(context.connection, composition.clock).readSummary(
            {
              workspaceId: context.workspaceId,
              period: period.value,
            },
          ),
        );

        if (!summary.ok) {
          return summary;
        }

        return accepted({
          status: 200,
          data: toDashboardSummaryDto(summary.value),
        });
      },
    },
    composition.handlerDeps,
  );
}

/** GET /api/analytics/evolution. */
export function createGetAnalyticsEvolutionHandler(
  deps: AnalyticsHttpDeps = {},
): ApiHandler {
  const composition = createServerComposition(deps);

  return createApiHandler<undefined, AnalyticsWindowQuery, MonthlyEvolutionDto>(
    {
      querySchema: analyticsWindowQuerySchema,
      handle(context) {
        const evolution = fromAnalytics(
          dashboardAnalytics(
            context.connection,
            composition.clock,
          ).readEvolution({ workspaceId: context.workspaceId }),
        );

        if (!evolution.ok) {
          return evolution;
        }

        return accepted({
          status: 200,
          data: toMonthlyEvolutionDto(evolution.value),
        });
      },
    },
    composition.handlerDeps,
  );
}

/** GET /api/analytics/averages. */
export function createGetAnalyticsAveragesHandler(
  deps: AnalyticsHttpDeps = {},
): ApiHandler {
  const composition = createServerComposition(deps);

  return createApiHandler<undefined, AnalyticsWindowQuery, MonthlyAveragesDto>(
    {
      querySchema: analyticsWindowQuerySchema,
      handle(context) {
        const averages = fromAnalytics(
          dashboardAnalytics(
            context.connection,
            composition.clock,
          ).readAverages({ workspaceId: context.workspaceId }),
        );

        if (!averages.ok) {
          return averages;
        }

        return accepted({
          status: 200,
          data: toMonthlyAveragesDto(averages.value),
        });
      },
    },
    composition.handlerDeps,
  );
}
