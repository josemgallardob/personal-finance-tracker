/**
 * Public HTTP schemas of categories and tags.
 *
 * Request and response shapes live here so the browser client and the route
 * handlers validate the same contract. The module has no domain, SQLite or
 * application-service imports: a client that reads these schemas cannot pull
 * persistence into the bundle.
 */

import { z } from "zod";

import { TRANSACTION_TYPES } from "../../transactions/domain/transaction-type";

/** Lifecycle filter a classification collection accepts. */
export const CLASSIFICATION_STATUSES = ["active", "archived", "all"] as const;

/** Closed set of lifecycle filters the classification collections accept. */
export type ClassificationListStatus = (typeof CLASSIFICATION_STATUSES)[number];

/** Type of a category, as the wire contract names it. */
export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);

/** Query of GET /api/categories. */
export const categoryListQuerySchema = z.strictObject({
  status: z.enum(CLASSIFICATION_STATUSES).optional(),
  type: transactionTypeSchema.optional(),
});

/** Body of POST /api/categories. */
export const createCategoryBodySchema = z.strictObject({
  name: z.string(),
  type: transactionTypeSchema,
});

/** Body of PATCH /api/categories/[id]. Type is immutable and rejected here. */
export const renameCategoryBodySchema = z.strictObject({
  name: z.string(),
});

/** Empty body of POST .../archive. Unknown keys are refused. */
export const archiveBodySchema = z.strictObject({});

/** Body of PUT /api/categories/order. */
export const reorderCategoriesBodySchema = z.strictObject({
  type: transactionTypeSchema,
  orderedCategoryIds: z.array(z.string()),
});

/** Query of GET /api/tags. */
export const tagListQuerySchema = z.strictObject({
  status: z.enum(CLASSIFICATION_STATUSES).optional(),
});

/** Body of POST /api/tags. */
export const createTagBodySchema = z.strictObject({
  name: z.string(),
});

/** Body of PATCH /api/tags/[id]. */
export const renameTagBodySchema = z.strictObject({
  name: z.string(),
});

/** Category as the API returns it. */
export const categoryDtoSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  type: transactionTypeSchema,
  isArchived: z.boolean(),
});

/** Collection of categories. */
export const categoryListDtoSchema = z.array(categoryDtoSchema);

/** Tag as the API returns it. */
export const tagDtoSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  isArchived: z.boolean(),
});

/** Collection of tags. */
export const tagListDtoSchema = z.array(tagDtoSchema);

export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>;
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;
export type RenameCategoryBody = z.infer<typeof renameCategoryBodySchema>;
export type ArchiveBody = z.infer<typeof archiveBodySchema>;
export type ReorderCategoriesBody = z.infer<typeof reorderCategoriesBodySchema>;
export type TagListQuery = z.infer<typeof tagListQuerySchema>;
export type CreateTagBody = z.infer<typeof createTagBodySchema>;
export type RenameTagBody = z.infer<typeof renameTagBodySchema>;
