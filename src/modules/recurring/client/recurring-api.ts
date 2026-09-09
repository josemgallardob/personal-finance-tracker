/**
 * Browser adapters for recurrence endpoints.
 */

import type {
  ApiClient,
  ApiClientResult,
  ApiRequestOptions,
} from "../../../shared/client/api-client";
import { parseApiData } from "../../../shared/client/parse-api-data";
import { apiPath, encodeApiPathSegment } from "../../../shared/client/query";
import type {
  RecurringRuleDto,
  RecurringRulesListDto,
} from "../contracts/recurring";
import {
  recurringRuleDtoSchema,
  recurringRulesListDtoSchema,
  type ActivateRecurringRuleBody,
  type PreviewNextDueDateBody,
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
  };
}

export function recurringRuleItemPath(ruleId: string): string {
  return apiPath(`/api/recurring-rules/${encodeApiPathSegment(ruleId)}`);
}
