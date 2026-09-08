/**
 * Transaction repository against a real, migrated SQLite file.
 *
 * The cases here check the exact round trip of a movement and its tags, the
 * workspace scope of every lookup and mutation, the constant number of
 * statements a read issues, the atomic rollback of a refused save and the
 * deletion that keeps the classification it used.
 */

import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { category, tag, transactionTag } from "../../../db/schema";
import type { TagId } from "../../../src/modules/classification/domain/tag";
import {
  type TransactionResult,
  failed,
} from "../../../src/modules/transactions/application/ports/transaction-repository";
import { sqliteTransactionRepository } from "../../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import {
  autocommitUnitOfWork,
  runInTransaction,
  type SqliteUnitOfWork,
} from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";
import type {
  Transaction,
  TransactionId,
} from "../../../src/modules/transactions/domain/transaction";
import {
  countStatements,
  createTransactionFixture,
  errorCode,
  newTransaction,
  okValue,
  storeCategory,
  storeTag,
  type TransactionFixture,
} from "./helpers";

const MISSING_WORKSPACE = "missing-workspace";

let fixture: TransactionFixture;
let unit: SqliteUnitOfWork;
let workspaceId: string;

beforeEach(() => {
  fixture = createTransactionFixture();
  unit = autocommitUnitOfWork(fixture.connection);
  workspaceId = fixture.workspaceId;
});

afterEach(() => {
  fixture.cleanup();
});

/** Saves a movement inside a transaction, as every caller of the port does. */
function save(stored: Transaction): TransactionResult<Transaction> {
  return runInTransaction(fixture.connection, (transactional) =>
    sqliteTransactionRepository.insertTransaction(transactional, {
      workspaceId,
      transaction: stored,
    }),
  );
}

function edit(stored: Transaction): TransactionResult<Transaction> {
  return runInTransaction(fixture.connection, (transactional) =>
    sqliteTransactionRepository.updateTransaction(transactional, {
      workspaceId,
      transaction: stored,
    }),
  );
}

function read(transactionId: TransactionId, scope = workspaceId) {
  return sqliteTransactionRepository.findTransactionById(unit, {
    workspaceId: scope,
    transactionId,
  });
}

function sorted(tagIds: readonly TagId[]): readonly TagId[] {
  return [...tagIds].sort();
}

describe("round trip of a stored movement", () => {
  it("reads back every field and tag of an inserted movement", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const tags = [storeTag(fixture, "Con Amigos"), storeTag(fixture, "Viaje")];
    const stored = newTransaction({
      category: expense,
      amountMinor: 1,
      date: "2024-02-29",
      concept: "Café con leche",
      note: "Primera línea\nSegunda línea",
      tagIds: tags.map((row) => row.id),
    });

    expect(okValue(save(stored))).toEqual(stored);
    expect(okValue(read(stored.id))).toEqual({
      ...stored,
      tagIds: sorted(stored.tagIds),
    });
  });

  it("reads back a movement without tags, concept or note", () => {
    const income = storeCategory(fixture, "Nómina", "income");
    const stored = newTransaction({
      category: income,
      amountMinor: 250_000,
      concept: null,
      note: null,
    });

    okValue(save(stored));

    const found = okValue(read(stored.id));

    expect(found).toEqual(stored);
    expect(found?.tagIds).toEqual([]);
  });

  it("returns null for a movement the workspace does not have", () => {
    expect(okValue(read(randomUUID() as TransactionId))).toBeNull();
  });

  it("hides a movement of another workspace from a scoped lookup", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense });

    okValue(save(stored));

    expect(okValue(read(stored.id, MISSING_WORKSPACE))).toBeNull();
  });
});

describe("batch reads without an association query per movement", () => {
  function storeMany(count: number, tagCount: number): readonly Transaction[] {
    const expense = storeCategory(fixture, "Comida", "expense");
    const tags = Array.from({ length: tagCount }, (_, index) =>
      storeTag(fixture, `Etiqueta ${index}`),
    );

    return Array.from({ length: count }, (_, index) => {
      const stored = newTransaction({
        category: expense,
        date: `2026-03-0${index + 1}`,
        tagIds: tags.map((row) => row.id),
      });

      okValue(save(stored));
      return stored;
    });
  }

  it("loads three movements and their fifteen associations in two statements", () => {
    const many = storeMany(3, 5);

    const counted = countStatements(fixture, () =>
      okValue(
        sqliteTransactionRepository.findTransactionsByIds(unit, {
          workspaceId,
          transactionIds: many.map((stored) => stored.id),
        }),
      ),
    );

    expect(counted.statements).toBe(2);
    expect(counted.value).toHaveLength(3);
    expect(counted.value[0]?.tagIds).toHaveLength(5);
  });

  it("keeps the same two statements when every movement has one tag", () => {
    const many = storeMany(3, 1);

    const counted = countStatements(fixture, () =>
      okValue(
        sqliteTransactionRepository.findTransactionsByIds(unit, {
          workspaceId,
          transactionIds: many.map((stored) => stored.id),
        }),
      ),
    );

    expect(counted.statements).toBe(2);
    expect(counted.value.map((stored) => stored.tagIds.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it("orders the batch by date, creation time and identifier descending", () => {
    const many = storeMany(3, 0);

    const found = okValue(
      sqliteTransactionRepository.findTransactionsByIds(unit, {
        workspaceId,
        transactionIds: many.map((stored) => stored.id),
      }),
    );

    expect(found.map((stored) => stored.date)).toEqual([
      "2026-03-03",
      "2026-03-02",
      "2026-03-01",
    ]);
  });

  it("skips identifiers the workspace does not own", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense });

    okValue(save(stored));

    const found = okValue(
      sqliteTransactionRepository.findTransactionsByIds(unit, {
        workspaceId,
        transactionIds: [stored.id, randomUUID() as TransactionId],
      }),
    );

    expect(found.map((row) => row.id)).toEqual([stored.id]);
  });

  it("reads nothing and prepares no statement for an empty batch", () => {
    const counted = countStatements(fixture, () =>
      okValue(
        sqliteTransactionRepository.findTransactionsByIds(unit, {
          workspaceId,
          transactionIds: [],
        }),
      ),
    );

    expect(counted).toEqual({ value: [], statements: 0 });
  });

  it("prepares a single statement when no movement matches the batch", () => {
    const counted = countStatements(fixture, () =>
      okValue(
        sqliteTransactionRepository.findTransactionsByIds(unit, {
          workspaceId,
          transactionIds: [randomUUID() as TransactionId],
        }),
      ),
    );

    expect(counted).toEqual({ value: [], statements: 1 });
  });
});

describe("refused insertions", () => {
  it("refuses to save a movement outside a transaction and writes nothing", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({
      category: expense,
      tagIds: [storeTag(fixture, "Viaje").id],
    });

    expect(
      errorCode(
        sqliteTransactionRepository.insertTransaction(unit, {
          workspaceId,
          transaction: stored,
        }),
      ),
    ).toBe("transactionRequired");
    expect(okValue(read(stored.id))).toBeNull();
  });

  it("refuses a movement whose identifier already exists", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense });

    okValue(save(stored));

    expect(
      errorCode(save(newTransaction({ id: stored.id, category: expense }))),
    ).toBe("duplicateId");
  });

  it("refuses a movement of a workspace that does not exist", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense });

    const refused = runInTransaction(fixture.connection, (transactional) =>
      sqliteTransactionRepository.insertTransaction(transactional, {
        workspaceId: MISSING_WORKSPACE,
        transaction: stored,
      }),
    );

    expect(errorCode(refused)).toBe("unknownWorkspace");
  });

  it("refuses a movement classified with a category the workspace lacks", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({
      category: { ...expense, id: randomUUID() as typeof expense.id },
    });

    expect(errorCode(save(stored))).toBe("unknownCategory");
  });

  it("refuses a movement whose type does not match its category", () => {
    const income = storeCategory(fixture, "Nómina", "income");
    const stored = newTransaction({ category: income });
    const mismatched: Transaction = { ...stored, type: "expense" };

    expect(errorCode(save(mismatched))).toBe("unknownCategory");
  });

  it("rolls the whole save back when one tag does not exist", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const known = storeTag(fixture, "Viaje");
    const stored = newTransaction({
      category: expense,
      tagIds: [known.id, randomUUID()],
    });

    expect(errorCode(save(stored))).toBe("unknownTag");
    expect(okValue(read(stored.id))).toBeNull();
    expect(
      fixture.connection.db.select().from(transactionTag).all(),
    ).toHaveLength(0);
  });
});

describe("editing a stored movement", () => {
  it("replaces the fields and the tag set and keeps the creation time", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const other = storeCategory(fixture, "Transporte", "expense", 1);
    const first = storeTag(fixture, "Viaje");
    const second = storeTag(fixture, "Con Amigos");
    const stored = newTransaction({
      category: expense,
      concept: "Café",
      tagIds: [first.id],
    });

    okValue(save(stored));

    const edited = newTransaction({
      id: stored.id,
      category: other,
      amountMinor: 9_999,
      date: "2026-04-01",
      concept: "Taxi",
      note: "Vuelta a casa",
      tagIds: [second.id],
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt + 1_000,
    });

    expect(okValue(edit(edited))).toEqual(edited);
    expect(okValue(read(stored.id))).toEqual(edited);
  });

  it("removes every tag when the edited movement has none", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({
      category: expense,
      tagIds: [storeTag(fixture, "Viaje").id],
    });

    okValue(save(stored));

    const cleared = newTransaction({
      id: stored.id,
      category: expense,
      tagIds: [],
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt + 1,
    });

    expect(okValue(edit(cleared)).tagIds).toEqual([]);
    expect(okValue(read(stored.id))?.tagIds).toEqual([]);
  });

  it("refuses to edit outside a transaction", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense });

    okValue(save(stored));

    expect(
      errorCode(
        sqliteTransactionRepository.updateTransaction(unit, {
          workspaceId,
          transaction: stored,
        }),
      ),
    ).toBe("transactionRequired");
  });

  it("refuses to edit a movement the workspace does not have", () => {
    const expense = storeCategory(fixture, "Comida", "expense");

    expect(errorCode(edit(newTransaction({ category: expense })))).toBe(
      "transactionNotFound",
    );
  });

  it("refuses to edit a movement through another workspace", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense, concept: "Café" });

    okValue(save(stored));

    const refused = runInTransaction(fixture.connection, (transactional) =>
      sqliteTransactionRepository.updateTransaction(transactional, {
        workspaceId: MISSING_WORKSPACE,
        transaction: { ...stored, concept: "Cambiado" },
      }),
    );

    expect(errorCode(refused)).toBe("transactionNotFound");
    expect(okValue(read(stored.id))?.concept).toBe("Café");
  });

  it("refuses an edit whose category the workspace lacks", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense });

    okValue(save(stored));

    const broken: Transaction = {
      ...stored,
      categoryId: randomUUID() as typeof expense.id,
    };

    expect(errorCode(edit(broken))).toBe("unknownCategory");
  });

  it("rolls an edit back and keeps the previous tags when a tag is unknown", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const known = storeTag(fixture, "Viaje");
    const stored = newTransaction({
      category: expense,
      amountMinor: 500,
      tagIds: [known.id],
    });

    okValue(save(stored));

    const broken = newTransaction({
      id: stored.id,
      category: expense,
      amountMinor: 700,
      tagIds: [randomUUID()],
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt + 1,
    });

    expect(errorCode(edit(broken))).toBe("unknownTag");

    const unchanged = okValue(read(stored.id));

    expect(unchanged?.amountMinor).toBe(500);
    expect(unchanged?.tagIds).toEqual([known.id]);
  });
});

describe("deleting a movement", () => {
  it("removes the movement and its associations but keeps its classification", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const label = storeTag(fixture, "Viaje");
    const stored = newTransaction({ category: expense, tagIds: [label.id] });

    okValue(save(stored));

    expect(
      okValue(
        sqliteTransactionRepository.deleteTransaction(unit, {
          workspaceId,
          transactionId: stored.id,
        }),
      ),
    ).toBe(stored.id);
    expect(okValue(read(stored.id))).toBeNull();
    expect(
      fixture.connection.db.select().from(transactionTag).all(),
    ).toHaveLength(0);
    expect(fixture.connection.db.select().from(category).all()).toHaveLength(1);
    expect(fixture.connection.db.select().from(tag).all()).toHaveLength(1);
  });

  it("refuses to delete a movement the workspace does not have", () => {
    expect(
      errorCode(
        sqliteTransactionRepository.deleteTransaction(unit, {
          workspaceId,
          transactionId: randomUUID() as TransactionId,
        }),
      ),
    ).toBe("transactionNotFound");
  });

  it("refuses to delete a movement through another workspace", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense });

    okValue(save(stored));

    expect(
      errorCode(
        sqliteTransactionRepository.deleteTransaction(unit, {
          workspaceId: MISSING_WORKSPACE,
          transactionId: stored.id,
        }),
      ),
    ).toBe("transactionNotFound");
    expect(okValue(read(stored.id))).not.toBeNull();
  });
});

describe("stored rows that no longer satisfy the domain", () => {
  it("refuses a movement whose concept holds a control character", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense, concept: "Café" });

    okValue(save(stored));
    fixture.connection.sqlite
      .prepare(
        "UPDATE `transaction` SET concept = 'Cafe' || char(7) WHERE id = ?",
      )
      .run(stored.id);

    const refused = read(stored.id);

    expect(errorCode(refused)).toBe("invalidStoredRow");
    expect(refused.ok ? "" : refused.error.cause).toContain(
      "concept:invalidCharacter",
    );
  });

  it("refuses a movement whose category lost its name", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense });

    okValue(save(stored));
    fixture.connection.sqlite
      .prepare("UPDATE category SET name = '   ' WHERE id = ?")
      .run(expense.id);

    const refused = read(stored.id);

    expect(errorCode(refused)).toBe("invalidStoredRow");
    expect(refused.ok ? "" : refused.error.cause).toContain(
      "category.name:required",
    );
  });
});

describe("associations the database can no longer reach", () => {
  /**
   * Removes the association table behind the adapter. The statements it issues
   * then fail for a reason the port does not model, which is the only way to
   * reach its unmodelled-failure paths without stubbing the driver.
   */
  function dropAssociationTable(): void {
    fixture.connection.sqlite.prepare("DROP TABLE transaction_tag").run();
  }

  it("reports a read whose association query fails as a storage failure", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({
      category: expense,
      tagIds: [storeTag(fixture, "Viaje").id],
    });

    okValue(save(stored));
    dropAssociationTable();

    expect(errorCode(read(stored.id))).toBe("storageFailure");
  });

  it("reports a save whose associations cannot be written and keeps nothing", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const label = storeTag(fixture, "Viaje");
    const stored = newTransaction({ category: expense, tagIds: [label.id] });

    dropAssociationTable();

    expect(errorCode(save(stored))).toBe("storageFailure");
    expect(
      fixture.connection.sqlite
        .prepare("SELECT count(*) AS total FROM `transaction`")
        .get(),
    ).toEqual({ total: 0 });
  });

  it("reports an edit whose associations cannot be replaced", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense, amountMinor: 500 });

    okValue(save(stored));
    dropAssociationTable();

    const edited = newTransaction({
      id: stored.id,
      category: expense,
      amountMinor: 700,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt + 1,
    });

    expect(errorCode(edit(edited))).toBe("storageFailure");
    expect(
      fixture.connection.sqlite
        .prepare(
          "SELECT amount_minor AS amount FROM `transaction` WHERE id = ?",
        )
        .get(stored.id),
    ).toEqual({ amount: 500 });
  });
});

describe("controlled storage failures", () => {
  it("reports a closed connection as a storage failure instead of throwing", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense });

    okValue(save(stored));
    fixture.connection.close();

    expect(errorCode(read(stored.id))).toBe("storageFailure");
    expect(
      errorCode(
        sqliteTransactionRepository.deleteTransaction(unit, {
          workspaceId,
          transactionId: stored.id,
        }),
      ),
    ).toBe("storageFailure");
  });

  it("reports a write failure that is not a constraint as a storage failure", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense });
    const transactional: SqliteUnitOfWork = {
      isTransactional: true,
      db: fixture.connection.db,
    };

    fixture.connection.close();

    const refused = sqliteTransactionRepository.insertTransaction(
      transactional,
      { workspaceId, transaction: stored },
    );

    expect(errorCode(refused)).toBe("storageFailure");
  });

  it("rolls back and reports a storage failure when the work throws", () => {
    const thrown = runInTransaction<Transaction>(fixture.connection, () => {
      throw new Error("unexpected");
    });

    expect(errorCode(thrown)).toBe("storageFailure");
    expect(thrown.ok ? "" : thrown.error.cause).toBe("unexpected");
  });

  it("describes a thrown value that is not an error", () => {
    const thrown = runInTransaction<Transaction>(fixture.connection, () => {
      throw "broken";
    });

    expect(errorCode(thrown)).toBe("storageFailure");
    expect(thrown.ok ? "" : thrown.error.cause).toBe("broken");
  });

  it("returns a refusal unchanged and leaves nothing behind", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = newTransaction({ category: expense });

    const refused = runInTransaction(fixture.connection, (transactional) => {
      okValue(
        sqliteTransactionRepository.insertTransaction(transactional, {
          workspaceId,
          transaction: stored,
        }),
      );

      return failed<Transaction>("transactionNotFound", "cancelled");
    });

    expect(refused).toEqual({
      ok: false,
      error: { code: "transactionNotFound", cause: "cancelled" },
    });
    expect(okValue(read(stored.id))).toBeNull();
  });
});
