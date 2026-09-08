/**
 * SQLite adapter of the recurrence rule port.
 *
 * It runs on the handle the caller owns, carries the workspace in every
 * statement and rebuilds stored rows through the domain contract before
 * returning them. Reads join the category the template classifies with and
 * load the template tags of the whole batch in one further statement, so the
 * number of statements does not grow with the number of rules.
 *
 * Advancing a rule is a conditional update rather than a read followed by a
 * write: the date to move from and the active state are part of the `WHERE`
 * clause, so the database decides the race and a writer that lost it updates
 * no row and is told so.
 */

import "server-only";

import { and, asc, eq, inArray, isNull, lte, type SQL } from "drizzle-orm";

import {
  category,
  recurringRule,
  recurringRuleTag,
  workspace,
} from "../../../../db/schema";
import {
  type Category,
  createCategory,
} from "../../classification/domain/category";
import type { TagId } from "../../classification/domain/tag";
import type { LocalDate } from "../../../shared/domain/dates";
import {
  type ActiveRuleBySourceQuery,
  type ActiveRulesQuery,
  type AdvanceNextDueDateCommand,
  type DeactivateRuleCommand,
  type DueRulesQuery,
  type InsertRuleCommand,
  type RecurringResult,
  type RecurringRuleRepository,
  type ReplaceActiveRuleCommand,
  type RuleForUpdateQuery,
  type StoredRecurringRule,
  failed,
  succeeded,
} from "../application/ports/recurring-repository";
import {
  type RecurringRule,
  createRecurringRule,
} from "../domain/recurring-rule";
import {
  describeCause,
  isForeignKeyViolation,
  isUniqueViolation,
} from "./sqlite-errors";
import type { SqliteUnitOfWork } from "./sqlite-unit-of-work";

/** Rule joined with the category that classifies its template, as stored. */
interface RuleRow {
  readonly id: string;
  readonly sourceTransactionId: string | null;
  readonly type: string;
  readonly amountMinor: number;
  readonly concept: string | null;
  readonly note: string | null;
  readonly monthlyDay: number;
  readonly nextDueDate: string;
  readonly templateVersion: number;
  readonly deactivatedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly categoryType: string;
  readonly categorySortOrder: number;
  readonly categoryArchivedAt: number | null;
}

/** Association row of the batch that carries the template tags of a rule. */
interface TemplateTagRow {
  readonly recurringRuleId: string;
  readonly tagId: string;
}

const SELECTED_COLUMNS = {
  id: recurringRule.id,
  sourceTransactionId: recurringRule.sourceTransactionId,
  type: recurringRule.type,
  amountMinor: recurringRule.amountMinor,
  concept: recurringRule.concept,
  note: recurringRule.note,
  monthlyDay: recurringRule.monthlyDay,
  nextDueDate: recurringRule.nextDueDate,
  templateVersion: recurringRule.templateVersion,
  deactivatedAt: recurringRule.deactivatedAt,
  createdAt: recurringRule.createdAt,
  updatedAt: recurringRule.updatedAt,
  categoryId: category.id,
  categoryName: category.name,
  categoryType: category.type,
  categorySortOrder: category.sortOrder,
  categoryArchivedAt: category.archivedAt,
};

/**
 * Reads the active rules that owe a date, oldest first.
 *
 * A deactivated rule is excluded in SQL rather than filtered afterwards, so a
 * rule that was stopped while the task was running never reaches the caller.
 */
function findDueRules(
  unit: SqliteUnitOfWork,
  query: DueRulesQuery,
): RecurringResult<readonly StoredRecurringRule[]> {
  return selectRules(
    unit,
    query.workspaceId,
    [
      eq(recurringRule.workspaceId, query.workspaceId),
      isNull(recurringRule.deactivatedAt),
      lte(recurringRule.nextDueDate, query.onOrBefore),
    ],
    [asc(recurringRule.nextDueDate), asc(recurringRule.id)],
  );
}

function findActiveRules(
  unit: SqliteUnitOfWork,
  query: ActiveRulesQuery,
): RecurringResult<readonly StoredRecurringRule[]> {
  return selectRules(
    unit,
    query.workspaceId,
    [
      eq(recurringRule.workspaceId, query.workspaceId),
      isNull(recurringRule.deactivatedAt),
    ],
    [
      asc(recurringRule.type),
      asc(recurringRule.nextDueDate),
      asc(recurringRule.id),
    ],
  );
}

function findActiveRuleBySource(
  unit: SqliteUnitOfWork,
  query: ActiveRuleBySourceQuery,
): RecurringResult<StoredRecurringRule | null> {
  const built = selectRules(
    unit,
    query.workspaceId,
    [
      eq(recurringRule.workspaceId, query.workspaceId),
      eq(recurringRule.sourceTransactionId, query.sourceTransactionId),
      isNull(recurringRule.deactivatedAt),
    ],
    [asc(recurringRule.id)],
  );

  if (!built.ok) {
    return built;
  }

  return succeeded(built.value[0] ?? null);
}

function findRuleForUpdate(
  unit: SqliteUnitOfWork,
  query: RuleForUpdateQuery,
): RecurringResult<StoredRecurringRule | null> {
  const built = selectRules(
    unit,
    query.workspaceId,
    [
      eq(recurringRule.workspaceId, query.workspaceId),
      eq(recurringRule.id, query.ruleId),
    ],
    [asc(recurringRule.id)],
  );

  if (!built.ok) {
    return built;
  }

  return succeeded(built.value[0] ?? null);
}

function selectRules(
  unit: SqliteUnitOfWork,
  workspaceId: string,
  conditions: readonly SQL[],
  order: readonly SQL[],
): RecurringResult<readonly StoredRecurringRule[]> {
  let rows: RuleRow[];

  try {
    rows = unit.db
      .select(SELECTED_COLUMNS)
      .from(recurringRule)
      .innerJoin(
        category,
        and(
          eq(category.id, recurringRule.categoryId),
          eq(category.workspaceId, recurringRule.workspaceId),
        ),
      )
      .where(and(...conditions))
      .orderBy(...order)
      .all();
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }

  return buildRules(unit, workspaceId, rows);
}

function insertRule(
  unit: SqliteUnitOfWork,
  command: InsertRuleCommand,
): RecurringResult<RecurringRule> {
  if (!unit.isTransactional) {
    return failed("transactionRequired");
  }

  const stored = command.rule;

  try {
    unit.db
      .insert(recurringRule)
      .values({
        id: stored.id,
        workspaceId: command.workspaceId,
        sourceTransactionId: stored.sourceTransactionId,
        type: stored.template.type,
        amountMinor: stored.template.amountMinor,
        categoryId: stored.template.categoryId,
        concept: stored.template.concept,
        note: stored.template.note,
        monthlyDay: stored.monthlyDay,
        nextDueDate: stored.nextDueDate,
        templateVersion: stored.templateVersion,
        deactivatedAt: stored.deactivatedAt,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      })
      .run();
  } catch (cause) {
    return ruleWriteFailure(unit, command.workspaceId, cause);
  }

  if (stored.template.tagIds.length === 0) {
    return succeeded(stored);
  }

  try {
    unit.db
      .insert(recurringRuleTag)
      .values(
        stored.template.tagIds.map((tagId) => ({
          recurringRuleId: stored.id,
          tagId,
          workspaceId: command.workspaceId,
        })),
      )
      .run();
  } catch (cause) {
    if (isForeignKeyViolation(cause)) {
      return failed("unknownTag", describeCause(cause));
    }

    return failed("storageFailure", describeCause(cause));
  }

  return succeeded(stored);
}

/**
 * Moves the next date of a rule only while it is active and still on `from`.
 *
 * The condition lives in the statement, so the update is atomic with the check
 * and two concurrent runs cannot both move the same rule forward.
 */
function advanceNextDueDate(
  unit: SqliteUnitOfWork,
  command: AdvanceNextDueDateCommand,
): RecurringResult<LocalDate> {
  let updated: { readonly id: string }[];

  try {
    updated = unit.db
      .update(recurringRule)
      .set({ nextDueDate: command.to, updatedAt: command.updatedAt })
      .where(
        and(
          eq(recurringRule.workspaceId, command.workspaceId),
          eq(recurringRule.id, command.ruleId),
          eq(recurringRule.nextDueDate, command.from),
          isNull(recurringRule.deactivatedAt),
        ),
      )
      .returning({ id: recurringRule.id })
      .all();
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }

  if (updated.length === 0) {
    return failed("staleNextDueDate");
  }

  return succeeded(command.to);
}

function replaceActiveRule(
  unit: SqliteUnitOfWork,
  command: ReplaceActiveRuleCommand,
): RecurringResult<RecurringRule> {
  if (!unit.isTransactional) {
    return failed("transactionRequired");
  }

  const stored = command.rule;
  let updated: { readonly id: string }[];

  try {
    updated = unit.db
      .update(recurringRule)
      .set({
        sourceTransactionId: stored.sourceTransactionId,
        type: stored.template.type,
        amountMinor: stored.template.amountMinor,
        categoryId: stored.template.categoryId,
        concept: stored.template.concept,
        note: stored.template.note,
        monthlyDay: stored.monthlyDay,
        nextDueDate: stored.nextDueDate,
        templateVersion: stored.templateVersion,
        deactivatedAt: stored.deactivatedAt,
        updatedAt: stored.updatedAt,
      })
      .where(
        and(
          eq(recurringRule.workspaceId, command.workspaceId),
          eq(recurringRule.id, stored.id),
          eq(recurringRule.templateVersion, command.expectedTemplateVersion),
          isNull(recurringRule.deactivatedAt),
        ),
      )
      .returning({ id: recurringRule.id })
      .all();
  } catch (cause) {
    return ruleWriteFailure(unit, command.workspaceId, cause);
  }

  if (updated.length === 0) {
    return ruleChangeFailure(unit, {
      workspaceId: command.workspaceId,
      ruleId: stored.id,
      expectedTemplateVersion: command.expectedTemplateVersion,
    });
  }

  const tags = replaceTemplateTags(
    unit,
    command.workspaceId,
    stored.id,
    stored.template.tagIds,
  );

  if (!tags.ok) {
    return tags;
  }

  return succeeded(stored);
}

function deactivateRule(
  unit: SqliteUnitOfWork,
  command: DeactivateRuleCommand,
): RecurringResult<RecurringRule> {
  let updated: { readonly id: string }[];

  try {
    updated = unit.db
      .update(recurringRule)
      .set({
        deactivatedAt: command.deactivatedAt,
        updatedAt: command.deactivatedAt,
      })
      .where(
        and(
          eq(recurringRule.workspaceId, command.workspaceId),
          eq(recurringRule.id, command.ruleId),
          eq(recurringRule.templateVersion, command.expectedTemplateVersion),
          isNull(recurringRule.deactivatedAt),
        ),
      )
      .returning({ id: recurringRule.id })
      .all();
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }

  if (updated.length === 0) {
    return ruleChangeFailure(unit, command);
  }

  const stored = findRuleForUpdate(unit, {
    workspaceId: command.workspaceId,
    ruleId: command.ruleId,
  });

  if (!stored.ok) {
    return stored;
  }

  if (stored.value === null) {
    return failed("ruleNotFound");
  }

  return succeeded(stored.value.rule);
}

function ruleChangeFailure(
  unit: SqliteUnitOfWork,
  query: {
    readonly workspaceId: string;
    readonly ruleId: string;
    readonly expectedTemplateVersion: number;
  },
): RecurringResult<RecurringRule> {
  const stored = findRuleForUpdate(unit, {
    workspaceId: query.workspaceId,
    ruleId: query.ruleId as RecurringRule["id"],
  });

  if (!stored.ok) {
    return stored;
  }

  if (stored.value === null) {
    return failed("ruleNotFound");
  }

  if (stored.value.rule.deactivatedAt !== null) {
    return failed("alreadyDeactivated");
  }

  if (stored.value.rule.templateVersion !== query.expectedTemplateVersion) {
    return failed("staleTemplateVersion");
  }

  return failed("staleNextDueDate");
}

function replaceTemplateTags(
  unit: SqliteUnitOfWork,
  workspaceId: string,
  ruleId: string,
  tagIds: readonly string[],
): RecurringResult<true> {
  try {
    unit.db
      .delete(recurringRuleTag)
      .where(
        and(
          eq(recurringRuleTag.workspaceId, workspaceId),
          eq(recurringRuleTag.recurringRuleId, ruleId),
        ),
      )
      .run();
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }

  if (tagIds.length === 0) {
    return succeeded(true);
  }

  try {
    unit.db
      .insert(recurringRuleTag)
      .values(
        tagIds.map((tagId) => ({
          recurringRuleId: ruleId,
          tagId,
          workspaceId,
        })),
      )
      .run();
  } catch (cause) {
    if (isForeignKeyViolation(cause)) {
      return failed("unknownTag", describeCause(cause));
    }

    return failed("storageFailure", describeCause(cause));
  }

  return succeeded(true);
}

/** Rebuilds a batch of rules with their template tags in one further read. */
function buildRules(
  unit: SqliteUnitOfWork,
  workspaceId: string,
  rows: readonly RuleRow[],
): RecurringResult<readonly StoredRecurringRule[]> {
  if (rows.length === 0) {
    return succeeded([]);
  }

  const associations = selectTemplateTags(
    unit,
    workspaceId,
    rows.map((row) => row.id),
  );

  if (!associations.ok) {
    return associations;
  }

  const built: StoredRecurringRule[] = [];

  for (const row of rows) {
    const stored = toStoredRule(row, associations.value.get(row.id) ?? []);

    if (!stored.ok) {
      return stored;
    }

    built.push(stored.value);
  }

  return succeeded(built);
}

function selectTemplateTags(
  unit: SqliteUnitOfWork,
  workspaceId: string,
  ruleIds: readonly string[],
): RecurringResult<ReadonlyMap<string, readonly TagId[]>> {
  let rows: TemplateTagRow[];

  try {
    rows = unit.db
      .select({
        recurringRuleId: recurringRuleTag.recurringRuleId,
        tagId: recurringRuleTag.tagId,
      })
      .from(recurringRuleTag)
      .where(
        and(
          eq(recurringRuleTag.workspaceId, workspaceId),
          inArray(recurringRuleTag.recurringRuleId, [...ruleIds]),
        ),
      )
      .orderBy(
        asc(recurringRuleTag.recurringRuleId),
        asc(recurringRuleTag.tagId),
      )
      .all();
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }

  const byRule = new Map<string, TagId[]>();

  for (const row of rows) {
    const tagIds = byRule.get(row.recurringRuleId) ?? [];
    tagIds.push(row.tagId as TagId);
    byRule.set(row.recurringRuleId, tagIds);
  }

  return succeeded(byRule);
}

/** Rebuilds a stored row and its template tags through the domain contract. */
function toStoredRule(
  row: RuleRow,
  tagIds: readonly TagId[],
): RecurringResult<StoredRecurringRule> {
  const classified = toCategory(row);

  if (!classified.ok) {
    return classified;
  }

  const built = createRecurringRule({
    id: row.id,
    sourceTransactionId: row.sourceTransactionId,
    type: row.type,
    amountMinor: row.amountMinor,
    category: classified.value,
    concept: row.concept,
    note: row.note,
    tagIds,
    monthlyDay: row.monthlyDay,
    nextDueDate: row.nextDueDate,
    templateVersion: row.templateVersion,
    deactivatedAt: row.deactivatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  if (!built.ok) {
    return failed(
      "invalidStoredRow",
      built.errors.map((error) => `${error.field}:${error.code}`).join(","),
    );
  }

  return succeeded({ rule: built.value, category: classified.value });
}

function toCategory(row: RuleRow): RecurringResult<Category> {
  const built = createCategory({
    id: row.categoryId,
    name: row.categoryName,
    type: row.categoryType,
    sortOrder: row.categorySortOrder,
    archivedAt: row.categoryArchivedAt,
  });

  if (!built.ok) {
    return failed(
      "invalidStoredRow",
      built.errors
        .map((error) => `category.${error.field}:${error.code}`)
        .join(","),
    );
  }

  return succeeded(built.value);
}

/**
 * Reads the verdict of a refused rule write.
 *
 * A unique violation is either the identifier of the rule or the partial index
 * that allows one active rule per origin movement; both mean the caller tried
 * to store a rule that cannot coexist with what is already there.
 */
function ruleWriteFailure(
  unit: SqliteUnitOfWork,
  workspaceId: string,
  cause: unknown,
): RecurringResult<RecurringRule> {
  if (isUniqueViolation(cause)) {
    return failed("duplicateId", describeCause(cause));
  }

  if (!isForeignKeyViolation(cause)) {
    return failed("storageFailure", describeCause(cause));
  }

  let workspaces: { readonly id: string }[];

  try {
    workspaces = unit.db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .all();
  } catch (lookupCause) {
    return failed("storageFailure", describeCause(lookupCause));
  }

  if (workspaces.length === 0) {
    return failed("unknownWorkspace", describeCause(cause));
  }

  return failed("unknownCategory", describeCause(cause));
}

/** Recurrence rule port backed by a real SQLite file. */
export const sqliteRecurringRuleRepository: RecurringRuleRepository<SqliteUnitOfWork> =
  {
    findDueRules,
    findActiveRules,
    findActiveRuleBySource,
    findRuleForUpdate,
    insertRule,
    replaceActiveRule,
    deactivateRule,
    advanceNextDueDate,
  };
