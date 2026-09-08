import { describe, expect, it } from "vitest";

import {
  E2E_HARNESS_ENV,
  E2E_HARNESS_ENABLED_VALUE,
  isE2eMaintenanceHarnessEnabled,
} from "./e2e-harness";

describe("isE2eMaintenanceHarnessEnabled", () => {
  it("stays off unless the dedicated E2E process sets the flag", () => {
    expect(isE2eMaintenanceHarnessEnabled({})).toBe(false);
    expect(isE2eMaintenanceHarnessEnabled({ [E2E_HARNESS_ENV]: "true" })).toBe(
      false,
    );
    expect(
      isE2eMaintenanceHarnessEnabled({
        [E2E_HARNESS_ENV]: E2E_HARNESS_ENABLED_VALUE,
      }),
    ).toBe(true);
  });
});
