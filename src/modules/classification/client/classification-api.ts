/**
 * Browser adapters for category and tag endpoints.
 *
 * Each method builds the documented URL and body, then validates the returned
 * representation against the public Zod contract. Persistence and application
 * services stay on the server; this module only talks to {@link ApiClient}.
 */

import type {
  ApiClient,
  ApiClientResult,
  ApiRequestOptions,
} from "../../../shared/client/api-client";
import { parseApiData } from "../../../shared/client/parse-api-data";
import { apiPath, encodeApiPathSegment } from "../../../shared/client/query";
import type { CategoryDto } from "../contracts/category";
import type { TagDto } from "../contracts/tag";
import {
  categoryListDtoSchema,
  categoryDtoSchema,
  tagDtoSchema,
  tagListDtoSchema,
  type ArchiveBody,
  type CategoryListQuery,
  type CreateCategoryBody,
  type CreateTagBody,
  type RenameCategoryBody,
  type RenameTagBody,
  type ReorderCategoriesBody,
  type TagListQuery,
} from "../contracts/http";

/** Category and tag operations of the browser API. */
export interface ClassificationApi {
  listCategories(
    query?: CategoryListQuery,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<readonly CategoryDto[]>>;
  createCategory(
    body: CreateCategoryBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<CategoryDto>>;
  renameCategory(
    categoryId: string,
    body: RenameCategoryBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<CategoryDto>>;
  archiveCategory(
    categoryId: string,
    body?: ArchiveBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<CategoryDto>>;
  reorderCategories(
    body: ReorderCategoriesBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<readonly CategoryDto[]>>;
  listTags(
    query?: TagListQuery,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<readonly TagDto[]>>;
  createTag(
    body: CreateTagBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TagDto>>;
  renameTag(
    tagId: string,
    body: RenameTagBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TagDto>>;
  archiveTag(
    tagId: string,
    body?: ArchiveBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TagDto>>;
}

function categoryItemPath(categoryId: string): string {
  return apiPath(`/api/categories/${encodeApiPathSegment(categoryId)}`);
}

function categoryArchivePath(categoryId: string): string {
  return apiPath(`/api/categories/${encodeApiPathSegment(categoryId)}/archive`);
}

function tagItemPath(tagId: string): string {
  return apiPath(`/api/tags/${encodeApiPathSegment(tagId)}`);
}

function tagArchivePath(tagId: string): string {
  return apiPath(`/api/tags/${encodeApiPathSegment(tagId)}/archive`);
}

/** Builds the classification adapters against a transport. */
export function createClassificationApi(client: ApiClient): ClassificationApi {
  return {
    async listCategories(query = {}, options) {
      return parseApiData(
        await client.get(
          apiPath("/api/categories", {
            status: query.status,
            type: query.type,
          }),
          options,
        ),
        categoryListDtoSchema,
      );
    },

    async createCategory(body, options) {
      return parseApiData(
        await client.post(apiPath("/api/categories"), body, options),
        categoryDtoSchema,
      );
    },

    async renameCategory(categoryId, body, options) {
      return parseApiData(
        await client.patch(categoryItemPath(categoryId), body, options),
        categoryDtoSchema,
      );
    },

    async archiveCategory(categoryId, body = {}, options) {
      return parseApiData(
        await client.post(categoryArchivePath(categoryId), body, options),
        categoryDtoSchema,
      );
    },

    async reorderCategories(body, options) {
      return parseApiData(
        await client.put(apiPath("/api/categories/order"), body, options),
        categoryListDtoSchema,
      );
    },

    async listTags(query = {}, options) {
      return parseApiData(
        await client.get(
          apiPath("/api/tags", { status: query.status }),
          options,
        ),
        tagListDtoSchema,
      );
    },

    async createTag(body, options) {
      return parseApiData(
        await client.post(apiPath("/api/tags"), body, options),
        tagDtoSchema,
      );
    },

    async renameTag(tagId, body, options) {
      return parseApiData(
        await client.patch(tagItemPath(tagId), body, options),
        tagDtoSchema,
      );
    },

    async archiveTag(tagId, body = {}, options) {
      return parseApiData(
        await client.post(tagArchivePath(tagId), body, options),
        tagDtoSchema,
      );
    },
  };
}
