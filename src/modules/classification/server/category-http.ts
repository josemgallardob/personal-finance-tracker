/**
 * Category HTTP handlers.
 *
 * GET/POST the collection, PATCH a name, POST archive and PUT a complete
 * active order of one type. Each handler is a factory so tests inject the same
 * environment, connection and log sink the pipeline already uses, while the
 * route files call the factory with process defaults.
 */

import "server-only";

import type { z } from "zod";

import { accepted, type ApiResult } from "../../../shared/server/http/failure";
import {
  createApiHandler,
  type ApiHandler,
  type ApiHandlerDeps,
  type ApiSuccess,
} from "../../../shared/server/http/handler";
import type { Category } from "../domain/category";
import { toCategoryDto, type CategoryDto } from "../contracts/category";
import { sqliteCategoryRepository } from "../infrastructure/sqlite-category-repository";
import {
  archiveBodySchema,
  autocommit,
  categoryIdFrom,
  categoryListQuerySchema,
  classificationMaintenance,
  createCategoryBodySchema,
  fromClassification,
  fromDomain,
  renameCategoryBodySchema,
  reorderCategoriesBodySchema,
  runDomainInTransaction,
} from "./http";

type CategoryListQuery = z.infer<typeof categoryListQuerySchema>;
type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;
type RenameCategoryBody = z.infer<typeof renameCategoryBodySchema>;
type ReorderCategoriesBody = z.infer<typeof reorderCategoriesBodySchema>;

/** GET /api/categories. */
export function createListCategoriesHandler(
  deps: ApiHandlerDeps = {},
): ApiHandler {
  return createApiHandler<undefined, CategoryListQuery, readonly CategoryDto[]>(
    {
      querySchema: categoryListQuerySchema,
      handle(context) {
        return mapList(
          fromClassification(
            sqliteCategoryRepository.listCategories(
              autocommit(context.connection),
              {
                workspaceId: context.workspaceId,
                status: context.query.status ?? "active",
                type: context.query.type,
              },
            ),
            "categoryId",
          ),
        );
      },
    },
    deps,
  );
}

/** POST /api/categories. */
export function createCreateCategoryHandler(
  deps: ApiHandlerDeps = {},
): ApiHandler {
  return createApiHandler<CreateCategoryBody, undefined, CategoryDto>(
    {
      bodySchema: createCategoryBodySchema,
      handle(context) {
        const created = fromDomain(
          classificationMaintenance().createCategory(
            autocommit(context.connection),
            {
              workspaceId: context.workspaceId,
              name: context.body.name,
              type: context.body.type,
            },
          ),
        );

        if (!created.ok) {
          return created;
        }

        return accepted({ status: 201, data: toCategoryDto(created.value) });
      },
    },
    deps,
  );
}

/** PATCH /api/categories/[id]. */
export function createRenameCategoryHandler(
  deps: ApiHandlerDeps = {},
): ApiHandler {
  return createApiHandler<RenameCategoryBody, undefined, CategoryDto>(
    {
      bodySchema: renameCategoryBodySchema,
      handle(context) {
        const categoryId = categoryIdFrom(context.url);

        if (!categoryId.ok) {
          return categoryId;
        }

        return mapItem(
          fromDomain(
            classificationMaintenance().renameCategory(
              autocommit(context.connection),
              {
                workspaceId: context.workspaceId,
                categoryId: categoryId.value,
                name: context.body.name,
              },
            ),
          ),
        );
      },
    },
    deps,
  );
}

/** POST /api/categories/[id]/archive. */
export function createArchiveCategoryHandler(
  deps: ApiHandlerDeps = {},
): ApiHandler {
  return createApiHandler<Record<string, never>, undefined, CategoryDto>(
    {
      bodySchema: archiveBodySchema,
      handle(context) {
        const categoryId = categoryIdFrom(context.url);

        if (!categoryId.ok) {
          return categoryId;
        }

        return mapItem(
          fromDomain(
            classificationMaintenance().archiveCategory(
              autocommit(context.connection),
              {
                workspaceId: context.workspaceId,
                categoryId: categoryId.value,
              },
            ),
          ),
        );
      },
    },
    deps,
  );
}

/** PUT /api/categories/order. */
export function createReorderCategoriesHandler(
  deps: ApiHandlerDeps = {},
): ApiHandler {
  return createApiHandler<
    ReorderCategoriesBody,
    undefined,
    readonly CategoryDto[]
  >(
    {
      bodySchema: reorderCategoriesBodySchema,
      handle(context) {
        const reordered = fromDomain(
          runDomainInTransaction(context.connection, (unit) =>
            classificationMaintenance().reorderCategories(unit, {
              workspaceId: context.workspaceId,
              type: context.body.type,
              orderedCategoryIds: context.body.orderedCategoryIds,
            }),
          ),
        );

        if (!reordered.ok) {
          return reordered;
        }

        return accepted({
          status: 200,
          data: reordered.value.map(toCategoryDto),
        });
      },
    },
    deps,
  );
}

function mapList(
  result: ApiResult<readonly Category[]>,
): ApiResult<ApiSuccess<readonly CategoryDto[]>> {
  if (!result.ok) {
    return result;
  }

  return accepted({ status: 200, data: result.value.map(toCategoryDto) });
}

function mapItem(
  result: ApiResult<Category>,
): ApiResult<ApiSuccess<CategoryDto>> {
  if (!result.ok) {
    return result;
  }

  return accepted({ status: 200, data: toCategoryDto(result.value) });
}
