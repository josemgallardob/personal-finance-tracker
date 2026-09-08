/**
 * Failure wording and state summary of the classification view.
 *
 * The four transport outcomes are not interchangeable for the owner, so each
 * one is pinned to the sentence that describes it.
 */

import { describe, expect, it } from "vitest";

import type { ApiClientFailure } from "../../../shared/client/api-client";
import {
  activeArchivedSummary,
  archiveCategoryLabel,
  archiveTagLabel,
  classificationFailureCopy,
  classificationFailureMessage,
  renameCategoryLabel,
  renameTagLabel,
} from "./classification-copy";

describe("classificationFailureMessage", () => {
  it("prefers the Spanish copy the server sent for a refused request", () => {
    const failure: ApiClientFailure = {
      ok: false,
      reason: "api",
      status: 503,
      error: {
        code: "serviceUnavailable",
        message: "El servicio no está disponible en este momento.",
        requestId: "req-01",
      },
    };

    expect(classificationFailureMessage(failure)).toBe(
      "El servicio no está disponible en este momento.",
    );
  });

  it("explains a request that never reached the application", () => {
    expect(classificationFailureMessage({ ok: false, reason: "network" })).toBe(
      classificationFailureCopy.network,
    );
  });

  it("explains a response that is not the documented contract", () => {
    expect(
      classificationFailureMessage({
        ok: false,
        reason: "invalidResponse",
        status: 200,
      }),
    ).toBe(classificationFailureCopy.invalidResponse);
  });

  it("explains an interrupted load without blaming the connection", () => {
    const message = classificationFailureMessage({
      ok: false,
      reason: "aborted",
    });

    expect(message).toBe(classificationFailureCopy.aborted);
    expect(message).not.toBe(classificationFailureCopy.network);
  });
});

describe("rename labels", () => {
  it("identifies the row being renamed without mixing English identifiers", () => {
    expect(renameCategoryLabel("Alquiler")).toBe("Renombrar Alquiler");
    expect(renameTagLabel("Vacaciones")).toBe("Renombrar Vacaciones");
  });
});

describe("archive labels", () => {
  it("identifies the row being archived without mixing English identifiers", () => {
    expect(archiveCategoryLabel("Alquiler")).toBe("Archivar Alquiler");
    expect(archiveTagLabel("Vacaciones")).toBe("Archivar Vacaciones");
  });
});

describe("activeArchivedSummary", () => {
  it("uses the singular for exactly one item of each state", () => {
    expect(activeArchivedSummary(1, 1)).toBe("1 activa · 1 archivada");
  });

  it("uses the plural for zero and for several items", () => {
    expect(activeArchivedSummary(0, 3)).toBe("0 activas · 3 archivadas");
    expect(activeArchivedSummary(4, 0)).toBe("4 activas · 0 archivadas");
  });
});
