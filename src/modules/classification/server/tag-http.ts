/**
 * Tag HTTP handlers.
 *
 * GET/POST the collection, PATCH a name and POST archive. There is no order
 * endpoint: tags have no sort of their own. Recurrence protection is REC-04
 * and is not applied here.
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
import type { Tag } from "../domain/tag";
import { toTagDto, type TagDto } from "../contracts/tag";
import { sqliteTagRepository } from "../infrastructure/sqlite-tag-repository";
import {
  archiveBodySchema,
  autocommit,
  classificationMaintenance,
  createTagBodySchema,
  fromClassification,
  fromDomain,
  renameTagBodySchema,
  tagIdFrom,
  tagListQuerySchema,
} from "./http";

type TagListQuery = z.infer<typeof tagListQuerySchema>;
type CreateTagBody = z.infer<typeof createTagBodySchema>;
type RenameTagBody = z.infer<typeof renameTagBodySchema>;

/** GET /api/tags. */
export function createListTagsHandler(deps: ApiHandlerDeps = {}): ApiHandler {
  return createApiHandler<undefined, TagListQuery, readonly TagDto[]>(
    {
      querySchema: tagListQuerySchema,
      handle(context) {
        return mapList(
          fromClassification(
            sqliteTagRepository.listTags(autocommit(context.connection), {
              workspaceId: context.workspaceId,
              status: context.query.status ?? "active",
            }),
            "tagId",
          ),
        );
      },
    },
    deps,
  );
}

/** POST /api/tags. */
export function createCreateTagHandler(deps: ApiHandlerDeps = {}): ApiHandler {
  return createApiHandler<CreateTagBody, undefined, TagDto>(
    {
      bodySchema: createTagBodySchema,
      handle(context) {
        const created = fromDomain(
          classificationMaintenance().createTag(
            autocommit(context.connection),
            {
              workspaceId: context.workspaceId,
              name: context.body.name,
            },
          ),
        );

        if (!created.ok) {
          return created;
        }

        return accepted({ status: 201, data: toTagDto(created.value) });
      },
    },
    deps,
  );
}

/** PATCH /api/tags/[id]. */
export function createRenameTagHandler(deps: ApiHandlerDeps = {}): ApiHandler {
  return createApiHandler<RenameTagBody, undefined, TagDto>(
    {
      bodySchema: renameTagBodySchema,
      handle(context) {
        const tagId = tagIdFrom(context.url);

        if (!tagId.ok) {
          return tagId;
        }

        return mapItem(
          fromDomain(
            classificationMaintenance().renameTag(
              autocommit(context.connection),
              {
                workspaceId: context.workspaceId,
                tagId: tagId.value,
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

/** POST /api/tags/[id]/archive. */
export function createArchiveTagHandler(deps: ApiHandlerDeps = {}): ApiHandler {
  return createApiHandler<Record<string, never>, undefined, TagDto>(
    {
      bodySchema: archiveBodySchema,
      handle(context) {
        const tagId = tagIdFrom(context.url);

        if (!tagId.ok) {
          return tagId;
        }

        return mapItem(
          fromDomain(
            classificationMaintenance().archiveTag(
              autocommit(context.connection),
              {
                workspaceId: context.workspaceId,
                tagId: tagId.value,
              },
            ),
          ),
        );
      },
    },
    deps,
  );
}

function mapList(
  result: ApiResult<readonly Tag[]>,
): ApiResult<ApiSuccess<readonly TagDto[]>> {
  if (!result.ok) {
    return result;
  }

  return accepted({ status: 200, data: result.value.map(toTagDto) });
}

function mapItem(result: ApiResult<Tag>): ApiResult<ApiSuccess<TagDto>> {
  if (!result.ok) {
    return result;
  }

  return accepted({ status: 200, data: toTagDto(result.value) });
}
