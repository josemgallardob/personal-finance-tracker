import { notFound } from "next/navigation";

import { isE2eMaintenanceHarnessEnabled } from "../../../shared/server/e2e-harness";
import { E2eRecurringHarness } from "./harness";

export const dynamic = "force-dynamic";

/** Dedicated, gated UI for driving the scheduled recurrence command in E2E. */
export default function E2eRecurringPage() {
  if (!isE2eMaintenanceHarnessEnabled()) {
    notFound();
  }

  return <E2eRecurringHarness />;
}
