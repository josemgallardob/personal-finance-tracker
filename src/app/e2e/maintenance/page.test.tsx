import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  E2E_HARNESS_ENV,
  E2E_HARNESS_ENABLED_VALUE,
} from "../../../shared/server/e2e-harness";

const notFound = vi.fn(() => {
  throw new Error("not-found");
});

vi.mock("next/navigation", () => ({
  notFound,
}));

describe("E2eMaintenancePage", () => {
  beforeEach(() => {
    notFound.mockClear();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hides the harness when the E2E process flag is absent", async () => {
    vi.resetModules();
    delete process.env[E2E_HARNESS_ENV];
    const { default: E2eMaintenancePage } = await import("./page");
    expect(() => E2eMaintenancePage()).toThrow("not-found");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("renders the harness when the dedicated E2E process enables it", async () => {
    vi.resetModules();
    vi.stubEnv(E2E_HARNESS_ENV, E2E_HARNESS_ENABLED_VALUE);
    const { default: E2eMaintenancePage } = await import("./page");
    expect(() => E2eMaintenancePage()).not.toThrow();
    expect(notFound).not.toHaveBeenCalled();
  });
});
