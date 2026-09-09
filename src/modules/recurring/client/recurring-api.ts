/**
 * Browser adapters for recurrence endpoints.
 *
 * Editing and deactivating a template first materialise the dates that were
 * already due with the previous template, so both answer the rule as it now
 * stands together with the dates they created. The list keeps the two apart:
 * a change that recovered movements has to be announced to the owner, and a
 * response parsed as a plain rule would silently lose that.
 */

import type {
  ApiClient,
  ApiClientResult,
  ApiRequestOptions,
} from "../../../shared/client/api-client";
import { parseApiData } from "../../../shared/client/parse-api-data";
import { apiPath, encodeApiPathSegment } from "../../../shared/client/query";
import type {
  CatchUpPreviewDto,
  RecurringRuleChangeDto,
  RecurringRuleDto,
  RecurringRulesListDto,
} from "../contracts/recurring";
import {
  catchUpPreviewDtoSchema,
  recurringRuleChangeDtoSchema,
  recurringRuleDtoSchema,
  recurringRulesListDtoSchema,
  type ActivateRecurringRuleBody,
  type DeactivateRecurringRuleBody,
  type PreviewNextDueDateBody,
  type RecurringRuleWriteBody,
} from "../contracts/http";

export interface RecurringApi {
  listRules(
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<RecurringRulesListDto>>;
  activateRule(
    body: ActivateRecurringRuleBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<RecurringRuleDto>>;
  previewNextDueDate(
    body: PreviewNextDueDateBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<{ readonly nextDueDate: string }>>;
  /** Overdue dates a later edit or deactivation would create. Reads only. */
  previewCatchUp(
    ruleId: string,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<CatchUpPreviewDto>>;
  updateRule(
    ruleId: string,
    body: RecurringRuleWriteBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<RecurringRuleChangeDto>>;
  deactivateRule(
    ruleId: string,
    body: DeactivateRecurringRuleBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<RecurringRuleChangeDto>>;
}

const nextDueDateSchema = recurringRuleDtoSchema.pick({
  nextDueDate: true,
});

export function createRecurringApi(client: ApiClient): RecurringApi {
  return {
    async listRules(options) {
      return parseApiData(
        await client.get(apiPath("/api/recurring-rules"), options),
        recurringRulesListDtoSchema,
      );
    },
    async activateRule(body, options) {
      return parseApiData(
        await client.post(apiPath("/api/recurring-rules"), body, options),
        recurringRuleDtoSchema,
      );
    },
    async previewNextDueDate(body, options) {
      return parseApiData(
        await client.post(
          apiPath("/api/recurring-rules/preview"),
          body,
          options,
        ),
        nextDueDateSchema,
      );
    },
    async previewCatchUp(ruleId, options) {
      return parseApiData(
        await client.post(
          `${recurringRuleItemPath(ruleId)}/preview`,
          undefined,
          options,
        ),
        catchUpPreviewDtoSchema,
      );
    },
    async updateRule(ruleId, body, options) {
      return parseApiData(
        await client.put(recurringRuleItemPath(ruleId), body, options),
        recurringRuleChangeDtoSchema,
      );
    },
    async deactivateRule(ruleId, body, options) {
      return parseApiData(
        await client.post(
          `${recurringRuleItemPath(ruleId)}/deactivate`,
          body,
          options,
        ),
        recurringRuleChangeDtoSchema,
      );
    },
  };
}

export function recurringRuleItemPath(ruleId: string): string {
  return apiPath(`/api/recurring-rules/${encodeApiPathSegment(ruleId)}`);
}
