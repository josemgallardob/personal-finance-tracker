import { describe, expect, it } from "vitest";

import { shouldRegisterStartupCatchUp } from "./instrumentation";

describe("shouldRegisterStartupCatchUp", () => {
  it("runs on a Node server that is not building", () => {
    expect(shouldRegisterStartupCatchUp({})).toBe(true);
    expect(shouldRegisterStartupCatchUp({ NEXT_RUNTIME: "nodejs" })).toBe(true);
  });

  it("skips the Edge runtime and a production build", () => {
    expect(shouldRegisterStartupCatchUp({ NEXT_RUNTIME: "edge" })).toBe(false);
    expect(
      shouldRegisterStartupCatchUp({
        NEXT_PHASE: "phase-production-build",
      }),
    ).toBe(false);
  });
});
