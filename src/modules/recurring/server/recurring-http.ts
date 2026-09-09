/**
 * Monthly recurrence HTTP handlers.
 *
 * All writes use the real SQLite ports in one transaction. The server clock
 * supplies today for previews and lifecycle changes; no route exposes the
 * scheduled recurrence runner.
 */

import "server-only";

import type { z } from "zod";

import { sqliteCategoryRepository } from "../../classification/infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../../classification/infrastructure/sqlite-tag-repository";
import { sqliteTransactionRepository } from "../../transactions/infrastructure/sqlite-transaction-repository";
import {
  autocommit,
  runDomainInTransaction,
} from "../../transactions/server/http";
import {
  accepted,
  refused,
  type ApiResult,
} from "../../../shared/server/http/failure";
import {
  createApiHandler,
  type ApiHandler,
} from "../../../shared/server/http/handler";
import {
  createServerComposition,
  type ServerCompositionDeps,
} from "../../../shared/server/composition";
import { domainError } from "../../../shared/domain/errors";
import { toApiFailure } from "../../../shared/server/http/domain-status";
import { sqliteRecurringOccurrenceRepository } from "../infrastructure/sqlite-recurring-occurrence-repository";
import { sqliteRecurringRuleRepository } from "../infrastructure/sqlite-recurring-rule-repository";
import { createRecurringLifecycle } from "../application/services/recurring-lifecycle";
import {
  toRecurringRuleDto,
  type RecurringRuleDto,
  type RecurringRulesListDto,
} from "../contracts/recurring";
import {
  activateRecurringRuleBodySchema,
  deactivateRecurringRuleBodySchema,
  previewNextDueDateBodySchema,
  recurringRuleWriteBodySchema,
} from "../contracts/http";

type ActivateBody = z.infer<typeof activateRecurringRuleBodySchema>;
type DeactivateBody = z.infer<typeof deactivateRecurringRuleBodySchema>;
type PreviewBody = z.infer<typeof previewNextDueDateBodySchema>;
type WriteBody = z.infer<typeof recurringRuleWriteBodySchema>;

/** A template change response, including dates materialised before it applied. */
export interface RecurringRuleChangeDto {
  readonly rule: RecurringRuleDto;
  readonly generatedDueDates: readonly string[];
}

/** A catch-up preview performed without mutating the database. */
export interface CatchUpPreviewDto {
  readonly rule: RecurringRuleDto;
  readonly pendingDueDates: readonly string[];
}

/** Test seams for recurrence handlers. */
export type RecurringHttpDeps = ServerCompositionDeps & {
  readonly createId?: () => string;
};

function lifecycle(deps: RecurringHttpDeps) {
  const composition = createServerComposition(deps);

  return {
    composition,
    service: createRecurringLifecycle({
      rules: sqliteRecurringRuleRepository,
      occurrences: sqliteRecurringOccurrenceRepository,
      transactions: sqliteTransactionRepository,
      categories: sqliteCategoryRepository,
      tags: sqliteTagRepository,
      clock: composition.clock,
      createId: deps.createId,
      now: deps.now,
    }),
  };
}

function ruleIdFrom(url: URL): ApiResult<string> {
  const segments = url.pathname.split("/").filter(Boolean);

  if (
    segments[0] !== "api" ||
    segments[1] !== "recurring-rules" ||
    segments.length !== 3
  ) {
    return refused(toApiFailure([domainError("id", "notFound")]));
  }

  return accepted(decodeURIComponent(segments[2] ?? ""));
}

function toChangeDto(change: {
  readonly rule: Parameters<typeof toRecurringRuleDto>[0];
  readonly generated: readonly { readonly scheduledFor: string }[];
}): RecurringRuleChangeDto {
  return {
    rule: toRecurringRuleDto(change.rule),
    generatedDueDates: change.generated.map((entry) => entry.scheduledFor),
  };
}

/** GET /api/recurring-rules. */
export function createListRecurringRulesHandler(
  deps: RecurringHttpDeps = {},
): ApiHandler {
  const bound = lifecycle(deps);
  return createApiHandler<undefined, undefined, RecurringRulesListDto>(
    {
      handle(context) {
        const listed = bound.service.listActiveRules(
          autocommit(context.connection),
          { workspaceId: context.workspaceId },
        );
        if (!listed.ok) {
          return refused(toApiFailure(listed.errors));
        }
        return accepted({
          status: 200,
          data: {
            expenses: listed.value.expenses.map(({ rule }) =>
              toRecurringRuleDto(rule),
            ),
            incomes: listed.value.incomes.map(({ rule }) =>
              toRecurringRuleDto(rule),
            ),
          },
        });
      },
    },
    bound.composition.handlerDeps,
  );
}

/** POST /api/recurring-rules. */
export function createActivateRecurringRuleHandler(
  deps: RecurringHttpDeps = {},
): ApiHandler {
  const bound = lifecycle(deps);
  return createApiHandler<ActivateBody, undefined, RecurringRuleDto>(
    {
      bodySchema: activateRecurringRuleBodySchema,
      handle(context) {
        const created = runDomainInTransaction(context.connection, (unit) =>
          bound.service.activateFromTransaction(unit, {
            workspaceId: context.workspaceId,
            transactionId: context.body.transactionId,
            monthlyDay: context.body.monthlyDay,
          }),
        );
        if (!created.ok) {
          return refused(toApiFailure(created.errors));
        }
        return accepted({
          status: 201,
          data: toRecurringRuleDto(created.value),
        });
      },
    },
    bound.composition.handlerDeps,
  );
}

/** POST /api/recurring-rules/preview. */
export function createPreviewNextDueDateHandler(
  deps: RecurringHttpDeps = {},
): ApiHandler {
  const bound = lifecycle(deps);
  return createApiHandler<
    PreviewBody,
    undefined,
    { readonly nextDueDate: string }
  >(
    {
      bodySchema: previewNextDueDateBodySchema,
      handle(context) {
        const preview = bound.service.previewNextDueDate({
          monthlyDay: context.body.monthlyDay,
        });
        if (!preview.ok) {
          return refused(toApiFailure(preview.errors));
        }
        return accepted({ status: 200, data: preview.value });
      },
    },
    bound.composition.handlerDeps,
  );
}

/** GET /api/recurring-rules/[id]. */
export function createGetRecurringRuleHandler(
  deps: RecurringHttpDeps = {},
): ApiHandler {
  const bound = lifecycle(deps);
  return createApiHandler<undefined, undefined, RecurringRuleDto>(
    {
      handle(context) {
        const ruleId = ruleIdFrom(context.url);
        if (!ruleId.ok) return ruleId;
        const preview = bound.service.previewCatchUp(
          autocommit(context.connection),
          {
            workspaceId: context.workspaceId,
            ruleId: ruleId.value,
          },
        );
        if (!preview.ok) return refused(toApiFailure(preview.errors));
        return accepted({
          status: 200,
          data: toRecurringRuleDto(preview.value.rule),
        });
      },
    },
    bound.composition.handlerDeps,
  );
}

/** PUT /api/recurring-rules/[id]. */
export function createUpdateRecurringRuleHandler(
  deps: RecurringHttpDeps = {},
): ApiHandler {
  const bound = lifecycle(deps);
  return createApiHandler<WriteBody, undefined, RecurringRuleChangeDto>(
    {
      bodySchema: recurringRuleWriteBodySchema,
      handle(context) {
        const ruleId = ruleIdFrom(context.url);
        if (!ruleId.ok) return ruleId;
        const changed = runDomainInTransaction(context.connection, (unit) =>
          bound.service.editRule(unit, {
            workspaceId: context.workspaceId,
            ruleId: ruleId.value,
            templateVersion: context.body.templateVersion,
            type: context.body.type,
            amountMinor: context.body.amountMinor,
            categoryId: context.body.categoryId,
            concept: context.body.concept ?? null,
            note: context.body.note ?? null,
            tags: context.body.tagInputs,
            monthlyDay: context.body.monthlyDay,
          }),
        );
        if (!changed.ok) return refused(toApiFailure(changed.errors));
        return accepted({ status: 200, data: toChangeDto(changed.value) });
      },
    },
    bound.composition.handlerDeps,
  );
}

/** POST /api/recurring-rules/[id]/preview. */
export function createPreviewCatchUpHandler(
  deps: RecurringHttpDeps = {},
): ApiHandler {
  const bound = lifecycle(deps);
  return createApiHandler<undefined, undefined, CatchUpPreviewDto>(
    {
      handle(context) {
        const ruleId = ruleIdFrom(
          new URL(context.url.href.replace(/\/preview$/u, "")),
        );
        if (!ruleId.ok) return ruleId;
        const preview = bound.service.previewCatchUp(
          autocommit(context.connection),
          {
            workspaceId: context.workspaceId,
            ruleId: ruleId.value,
          },
        );
        if (!preview.ok) return refused(toApiFailure(preview.errors));
        return accepted({
          status: 200,
          data: {
            rule: toRecurringRuleDto(preview.value.rule),
            pendingDueDates: preview.value.pending,
          },
        });
      },
    },
    bound.composition.handlerDeps,
  );
}

/** POST /api/recurring-rules/[id]/deactivate. */
export function createDeactivateRecurringRuleHandler(
  deps: RecurringHttpDeps = {},
): ApiHandler {
  const bound = lifecycle(deps);
  return createApiHandler<DeactivateBody, undefined, RecurringRuleChangeDto>(
    {
      bodySchema: deactivateRecurringRuleBodySchema,
      handle(context) {
        const ruleId = ruleIdFrom(
          new URL(context.url.href.replace(/\/deactivate$/u, "")),
        );
        if (!ruleId.ok) return ruleId;
        const changed = runDomainInTransaction(context.connection, (unit) =>
          bound.service.deactivateRule(unit, {
            workspaceId: context.workspaceId,
            ruleId: ruleId.value,
            templateVersion: context.body.templateVersion,
          }),
        );
        if (!changed.ok) return refused(toApiFailure(changed.errors));
        return accepted({ status: 200, data: toChangeDto(changed.value) });
      },
    },
    bound.composition.handlerDeps,
  );
}
