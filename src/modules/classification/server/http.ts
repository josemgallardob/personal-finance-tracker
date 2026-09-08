/**
 * Shared composition of classification HTTP endpoints.
 *
 * Route handlers resolve the workspace through the API pipeline, then talk to
 * the real SQLite ports. This module owns the mapping a repository refusal
 * becomes, the transactional boundary a complete reorder needs, and the
 * identifier the dynamic path carries. It never accepts a workspace from the
 * request and never inspects recurrence rules: that protection is REC-04.
 */

import "server-only";

import { z } from "zod";

import type { DomainError, DomainResult } from "../../../shared/domain/errors";
import { domainError, invalid } from "../../../shared/domain/errors";
import type { SqliteConnection } from "../../../shared/server/database";
import {
  accepted,
  apiFailure,
  refused,
  type ApiResult,
} from "../../../shared/server/http/failure";
import { toApiFailure } from "../../../shared/server/http/domain-status";
import { apiObject } from "../../../shared/server/http/schema";
import { createClassificationMaintenance } from "../application/services/classification-maintenance";
import type {
  ClassificationRepositoryError,
  ClassificationResult,
} from "../application/ports/classification-repository";
import { sqliteCategoryRepository } from "../infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../infrastructure/sqlite-tag-repository";
import {
  autocommitUnitOfWork,
  type SqliteUnitOfWork,
} from "../infrastructure/sqlite-unit-of-work";

/** Lifecycle filter a classification collection accepts. */
export const CLASSIFICATION_STATUSES = ["active", "archived", "all"] as const;

/** Query of GET /api/categories. */
export const categoryListQuerySchema = apiObject({
  status: z.enum(CLASSIFICATION_STATUSES).optional(),
  type: z.enum(["expense", "income"]).optional(),
});

/** Body of POST /api/categories. */
export const createCategoryBodySchema = apiObject({
  name: z.string(),
  type: z.enum(["expense", "income"]),
});

/** Body of PATCH /api/categories/[id]. Type is immutable and rejected here. */
export const renameCategoryBodySchema = apiObject({
  name: z.string(),
});

/** Empty body of POST .../archive. Unknown keys are refused. */
export const archiveBodySchema = apiObject({});

/** Body of PUT /api/categories/order. */
export const reorderCategoriesBodySchema = apiObject({
  type: z.enum(["expense", "income"]),
  orderedCategoryIds: z.array(z.string()),
});

/** Query of GET /api/tags. */
export const tagListQuerySchema = apiObject({
  status: z.enum(CLASSIFICATION_STATUSES).optional(),
});

/** Body of POST /api/tags. */
export const createTagBodySchema = apiObject({
  name: z.string(),
});

/** Body of PATCH /api/tags/[id]. */
export const renameTagBodySchema = apiObject({
  name: z.string(),
});

/** Thrown to make SQLite roll back a domain refusal inside a transaction. */
const ROLLBACK_SIGNAL = new Error("Classification HTTP work was rolled back");

/** Maintenance services wired to the real SQLite adapters. */
export function classificationMaintenance() {
  return createClassificationMaintenance({
    categories: sqliteCategoryRepository,
    tags: sqliteTagRepository,
  });
}

/** Unit that commits each statement on its own. */
export function autocommit(connection: SqliteConnection): SqliteUnitOfWork {
  return autocommitUnitOfWork(connection);
}

/**
 * Runs domain work inside one SQL transaction the HTTP adapter owns.
 *
 * A complete reorder writes several rows. The transaction commits only when the
 * work reports success, so an incomplete identifier list never leaves a
 * half-applied order behind.
 */
export function runDomainInTransaction<TValue>(
  connection: SqliteConnection,
  work: (unit: SqliteUnitOfWork) => DomainResult<TValue>,
): DomainResult<TValue> {
  let refusal: DomainResult<TValue> | undefined;

  try {
    return connection.db.transaction((tx) => {
      const result = work({ isTransactional: true, db: tx });

      if (!result.ok) {
        refusal = result;
        throw ROLLBACK_SIGNAL;
      }

      return result;
    });
  } catch {
    if (refusal) {
      return refusal;
    }

    return invalid([domainError("storage", "unavailable")]);
  }
}

/** Turns a domain outcome into the pipeline's accepted or refused value. */
export function fromDomain<TValue>(
  result: DomainResult<TValue>,
): ApiResult<TValue> {
  if (result.ok) {
    return accepted(result.value);
  }

  return refused(toApiFailure(result.errors));
}

/** Turns a repository outcome into the pipeline's accepted or refused value. */
export function fromClassification<TValue>(
  result: ClassificationResult<TValue>,
  nameField: string,
): ApiResult<TValue> {
  if (result.ok) {
    return accepted(result.value);
  }

  return refused(toApiFailure([toDomainError(result.error, nameField)]));
}

/**
 * Turns a repository refusal into the field error HTTP already knows how to
 * map. Duplicate names stay conflicts; a missing row is not found; an
 * incomplete order is unprocessable; storage failures stay unnamed 503s.
 */
export function toDomainError(
  error: ClassificationRepositoryError,
  nameField: string,
): DomainError {
  switch (error.code) {
    case "duplicateName":
      return domainError(nameField, "duplicateName");
    case "duplicateId":
      return domainError("id", "invalidIdentifier");
    case "categoryNotFound":
      return domainError("categoryId", "notFound");
    case "tagNotFound":
      return domainError("tagId", "notFound");
    case "alreadyArchived":
      return domainError(nameField, "alreadyArchived");
    case "invalidCategoryOrder":
    case "transactionRequired":
      return domainError("orderedCategoryIds", "invalidSortOrder");
    case "unknownWorkspace":
      return domainError("workspaceId", "notFound");
    case "invalidStoredRow":
    case "storageFailure":
      return domainError("storage", "unavailable");
  }
}

/** Identifier of a category item or archive path, or a 404 when it is absent. */
export function categoryIdFrom(url: URL): ApiResult<string> {
  return pathIdFrom(url, "categories", "order");
}

/** Identifier of a tag item or archive path, or a 404 when it is absent. */
export function tagIdFrom(url: URL): ApiResult<string> {
  return pathIdFrom(url, "tags");
}

function pathIdFrom(
  url: URL,
  collection: "categories" | "tags",
  reserved?: string,
): ApiResult<string> {
  const segments = url.pathname.split("/").filter((segment) => segment !== "");

  if (segments[0] !== "api" || segments[1] !== collection) {
    return refused(apiFailure("notFound"));
  }

  const id = segments[2];

  if (id === undefined || id === reserved) {
    return refused(apiFailure("notFound"));
  }

  if (
    segments.length === 3 ||
    (segments.length === 4 && segments[3] === "archive")
  ) {
    return accepted(decodeURIComponent(id));
  }

  return refused(apiFailure("notFound"));
}
