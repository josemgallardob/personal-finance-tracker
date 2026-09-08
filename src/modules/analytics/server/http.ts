/**
 * Shared composition of the dashboard analytics endpoints.
 *
 * The three reads are pure aggregations of the implicit personal workspace, so
 * this module owns exactly two things a route must not get wrong: how the query
 * string becomes a documented period, and what HTTP status an analytics refusal
 * always produces.
 *
 * The query surface is deliberately narrow. A dashboard selection of categories
 * or tags decides what the interface draws, never what the server sums, so no
 * analytics endpoint accepts a series filter: an unknown parameter is refused by
 * the strict schema instead of silently changing a global figure. The evolution
 * and the averages accept no parameter at all, because their windows are rules
 * of the calendar and of the stored history, not of the request.
 */

import "server-only";

import { z } from "zod";

import type { ApiFieldErrorDto } from "../../../shared/contracts/api";
import { parseMonthKey, type MonthKey } from "../../../shared/domain/dates";
import {
  accepted,
  apiFailure,
  refused,
  type ApiFailure,
  type ApiResult,
} from "../../../shared/server/http/failure";
import { apiObject } from "../../../shared/server/http/schema";
import type {
  DashboardAnalyticsError,
  DashboardAnalyticsResult,
} from "../application/dashboard-analytics";
import {
  DASHBOARD_PERIOD_KINDS,
  type DashboardPeriod,
} from "../domain/periods";

/**
 * Query of `GET /api/analytics/summary`.
 *
 * `period` is required: a missing selection is a client mistake, not a silent
 * default that would make the cards disagree with the selector that produced
 * them. `from` and `to` are natural months and belong to `customMonthRange`
 * alone; every other parameter, including a category or tag selection, is
 * rejected as an unknown field.
 */
export const analyticsSummaryQuerySchema = apiObject({
  period: z.enum(DASHBOARD_PERIOD_KINDS),
  from: z.string().optional(),
  to: z.string().optional(),
});

/** Query of the endpoints whose window is a rule rather than a request. */
export const analyticsWindowQuerySchema = apiObject({});

/** Validated query of the summary endpoint. */
export type AnalyticsSummaryQuery = z.infer<typeof analyticsSummaryQuerySchema>;

/** Validated query of the endpoints that accept no parameter. */
export type AnalyticsWindowQuery = z.infer<typeof analyticsWindowQuerySchema>;

function fieldFailure(details: readonly ApiFieldErrorDto[]): ApiFailure {
  return apiFailure("validationFailed", details);
}

/** One month of a custom range: the value it names, or why it was refused. */
type MonthOutcome =
  | { readonly ok: true; readonly month: MonthKey }
  | { readonly ok: false; readonly error: ApiFieldErrorDto };

function readMonth(
  field: "from" | "to",
  value: string | undefined,
): MonthOutcome {
  if (value === undefined) {
    return { ok: false, error: { field, code: "required" } };
  }

  const parsed = parseMonthKey(value);

  if (!parsed.ok) {
    return { ok: false, error: { field, code: "invalidDate" } };
  }

  return { ok: true, month: parsed.value };
}

function unexpectedMonthErrors(
  query: AnalyticsSummaryQuery,
): readonly ApiFieldErrorDto[] {
  return (["from", "to"] as const)
    .filter((field) => query[field] !== undefined)
    .map((field) => ({ field, code: "unknownField" as const }));
}

/**
 * Turns the validated query into the documented period.
 *
 * A preset carries no months: sending them would describe a range the server
 * does not use, so they are refused instead of ignored. A custom range needs
 * both months, and each of them must be a real natural month; when both are
 * wrong they are reported together so a form can mark both at once.
 */
export function resolveDashboardPeriod(
  query: AnalyticsSummaryQuery,
): ApiResult<DashboardPeriod> {
  if (query.period !== "customMonthRange") {
    const unexpected = unexpectedMonthErrors(query);

    if (unexpected.length > 0) {
      return refused(fieldFailure(unexpected));
    }

    return accepted({ kind: query.period });
  }

  const from = readMonth("from", query.from);
  const to = readMonth("to", query.to);

  if (!from.ok && !to.ok) {
    return refused(fieldFailure([from.error, to.error]));
  }

  if (!from.ok) {
    return refused(fieldFailure([from.error]));
  }

  if (!to.ok) {
    return refused(fieldFailure([to.error]));
  }

  return accepted({
    kind: "customMonthRange",
    from: from.month,
    to: to.month,
  });
}

/**
 * Status an analytics refusal always maps to.
 *
 * A reversed or unrepresentable month range is about the submitted selection,
 * so it is unprocessable content and names the field that has to change. The
 * remaining reasons describe the server: a sum that no longer fits an exact
 * integer, a stored row that breaks its own contract and an unusable storage
 * engine are all temporary service failures, and none of them says more than
 * that.
 */
export function toAnalyticsFailure(error: DashboardAnalyticsError): ApiFailure {
  switch (error.code) {
    case "invalidMonthRange":
      return fieldFailure([{ field: "to", code: "incompatibleFilters" }]);
    case "monthOutOfRange":
      return fieldFailure([{ field: "from", code: "invalidDate" }]);
    case "amountOverflow":
    case "invalidStoredRow":
    case "storageFailure":
      return apiFailure("serviceUnavailable");
  }
}

/** Turns an analytics outcome into the pipeline's accepted or refused value. */
export function fromAnalytics<TValue>(
  result: DashboardAnalyticsResult<TValue>,
): ApiResult<TValue> {
  if (result.ok) {
    return accepted(result.value);
  }

  return refused(toAnalyticsFailure(result.error));
}
