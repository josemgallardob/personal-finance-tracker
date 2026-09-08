/**
 * Client name rules and mapping of server field errors for classification forms.
 */

import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ApiClientFailure } from "../../../shared/client/api-client";
import { classificationFailureCopy } from "./classification-copy";
import {
  classifyClassificationName,
  classificationFormCopy,
  classificationFormSummary,
  classificationSubmitErrors,
  createCategoryFormSchema,
  createTagFormSchema,
  focusClassificationAlert,
  hasNormalizedNameConflict,
  renameCategoryFormSchema,
  renameTagFormSchema,
  scheduleClassificationAlertFocus,
} from "./classification-form";

const expense = {
  id: "cat-1",
  name: "Alquiler",
  type: "expense" as const,
  isArchived: false,
};

const incomeTwin = {
  id: "cat-2",
  name: "Alquiler",
  type: "income" as const,
  isArchived: false,
};

const archived = {
  id: "cat-3",
  name: "Tabaco",
  type: "expense" as const,
  isArchived: true,
};

describe("classifyClassificationName", () => {
  it("rejects an empty or whitespace-only name", () => {
    expect(classifyClassificationName("   ", 80)).toBe("required");
  });

  it("rejects a name longer than 80 graphemes", () => {
    expect(classifyClassificationName("a".repeat(81), 80)).toBe("tooLong");
  });

  it("rejects a control character instead of stripping it", () => {
    expect(classifyClassificationName("Casa\u0007", 80)).toBe(
      "invalidCharacter",
    );
  });

  it("accepts an accented name within the limit", () => {
    expect(classifyClassificationName("  Café  ", 80)).toBeUndefined();
  });
});

describe("hasNormalizedNameConflict", () => {
  it("collides on case but keeps accents distinct", () => {
    expect(hasNormalizedNameConflict("  ALQUILER  ", [expense])).toBe(true);
    expect(hasNormalizedNameConflict("Alquilér", [expense])).toBe(false);
  });

  it("ignores archived rows and the row being renamed", () => {
    expect(hasNormalizedNameConflict("Tabaco", [archived])).toBe(false);
    expect(hasNormalizedNameConflict("Alquiler", [expense], expense.id)).toBe(
      false,
    );
  });
});

describe("createCategoryFormSchema", () => {
  it("normalizes the name and keeps the chosen type", () => {
    const parsed = createCategoryFormSchema([expense]).safeParse({
      name: "  Café  ",
      type: "income",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ name: "Café", type: "income" });
    }
  });

  it("allows the same written name in the other immutable type", () => {
    const parsed = createCategoryFormSchema([expense, incomeTwin]).safeParse({
      name: "Alquiler",
      type: "expense",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        classificationFormCopy.categoryDuplicateName,
      );
    }

    const otherType = createCategoryFormSchema([expense]).safeParse({
      name: "Alquiler",
      type: "income",
    });

    expect(otherType.success).toBe(true);
  });

  it("rejects a name that is too long or contains a control character", () => {
    expect(
      createCategoryFormSchema([]).safeParse({
        name: "a".repeat(81),
        type: "expense",
      }).success,
    ).toBe(false);
    expect(
      createTagFormSchema([]).safeParse({ name: "Casa\u0007" }).success,
    ).toBe(false);
  });
});

describe("rename schemas", () => {
  it("lets a category keep its current name and refuses another active one", () => {
    const same = renameCategoryFormSchema(
      [expense, incomeTwin],
      expense,
    ).safeParse({ name: "Alquiler", type: "expense" });
    const clash = renameCategoryFormSchema(
      [expense, { ...expense, id: "cat-9", name: "Supermercado" }],
      expense,
    ).safeParse({ name: "Supermercado", type: "expense" });

    expect(same.success).toBe(true);
    expect(clash.success).toBe(false);
  });

  it("applies global uniqueness to tags", () => {
    const tags = [
      { id: "tag-1", name: "Vacaciones", isArchived: false },
      { id: "tag-2", name: "Navidad", isArchived: false },
    ];

    expect(
      createTagFormSchema(tags).safeParse({ name: "vacaciones" }).success,
    ).toBe(false);
    expect(
      renameTagFormSchema(tags, tags[0]!).safeParse({ name: "Navidad" })
        .success,
    ).toBe(false);
    expect(
      renameTagFormSchema(tags, tags[0]!).safeParse({ name: "Vacaciones" })
        .success,
    ).toBe(true);
  });
});

describe("classificationSubmitErrors", () => {
  it("maps a duplicateName detail onto the name field", () => {
    const failure: ApiClientFailure = {
      ok: false,
      reason: "api",
      status: 409,
      error: {
        code: "conflict",
        message: "El estado actual del recurso no permite esta operación.",
        requestId: "req-1",
        details: [{ field: "name", code: "duplicateName" }],
      },
    };

    expect(classificationSubmitErrors(failure, "tag")).toEqual({
      name: classificationFormCopy.tagDuplicateName,
    });
  });

  it("maps required, length and control-character codes onto the name", () => {
    const asFailure = (
      code: "required" | "tooLong" | "tooBig" | "invalidCharacter",
    ) =>
      classificationSubmitErrors(
        {
          ok: false,
          reason: "api",
          status: 422,
          error: {
            code: "validationFailed",
            message: "Los datos enviados no son válidos.",
            requestId: "req-1",
            details: [{ field: "name", code }],
          },
        },
        "category",
      );

    expect(asFailure("required")).toEqual({
      name: classificationFormCopy.nameRequired,
    });
    expect(asFailure("tooLong")).toEqual({
      name: classificationFormCopy.nameTooLong,
    });
    expect(asFailure("tooBig")).toEqual({
      name: classificationFormCopy.nameTooLong,
    });
    expect(asFailure("invalidCharacter")).toEqual({
      name: classificationFormCopy.nameInvalidCharacter,
    });
  });

  it("maps an invalid type onto the type field", () => {
    const failure: ApiClientFailure = {
      ok: false,
      reason: "api",
      status: 422,
      error: {
        code: "validationFailed",
        message: "Los datos enviados no son válidos.",
        requestId: "req-1",
        details: [{ field: "type", code: "invalidTransactionType" }],
      },
    };

    expect(classificationSubmitErrors(failure, "category")).toEqual({
      type: classificationFormCopy.typeRequired,
    });
  });

  it("keeps a generic API sentence when no field can be marked", () => {
    const failure: ApiClientFailure = {
      ok: false,
      reason: "api",
      status: 500,
      error: {
        code: "internalError",
        message: "Se ha producido un error inesperado.",
        requestId: "req-1",
        details: [{ field: "id", code: "notFound" }],
      },
    };

    expect(classificationSubmitErrors(failure, "category")).toEqual({
      form: "Se ha producido un error inesperado.",
    });
  });

  it("uses the transport wording when the server was never reached", () => {
    expect(
      classificationSubmitErrors({ ok: false, reason: "network" }, "category"),
    ).toEqual({ form: classificationFailureCopy.network });
    expect(
      classificationSubmitErrors(
        { ok: false, reason: "invalidResponse", status: 200 },
        "category",
      ).form,
    ).toBe(classificationFailureCopy.invalidResponse);
    expect(
      classificationSubmitErrors({ ok: false, reason: "aborted" }, "category")
        .form,
    ).toBe(classificationFailureCopy.aborted);
  });
});

describe("classificationFormSummary", () => {
  it("links field copy and keeps a form-level sentence without a target", () => {
    expect(
      classificationFormSummary(
        [
          {
            fieldId: "category-name",
            message: classificationFormCopy.nameRequired,
          },
          { fieldId: "category-type-gasto" },
        ],
        classificationFailureCopy.network,
      ),
    ).toEqual([
      {
        fieldId: "category-name",
        message: classificationFormCopy.nameRequired,
      },
      { message: classificationFailureCopy.network },
    ]);
  });
});

describe("focusClassificationAlert", () => {
  it("moves focus to the form alert so a failure is announced", () => {
    const root = document.createElement("div");
    const alert = document.createElement("div");
    alert.setAttribute("role", "alert");
    alert.tabIndex = -1;
    root.append(alert);
    document.body.append(root);

    focusClassificationAlert(root);
    expect(alert).toHaveFocus();

    focusClassificationAlert(null);
    root.remove();
  });

  it("schedules alert focus after the current call stack", async () => {
    const root = document.createElement("div");
    const alert = document.createElement("div");
    alert.setAttribute("role", "alert");
    alert.tabIndex = -1;
    root.append(alert);
    document.body.append(root);

    scheduleClassificationAlertFocus(root);
    expect(alert).not.toHaveFocus();

    await waitFor(() => {
      expect(alert).toHaveFocus();
    });

    root.remove();
  });
});
