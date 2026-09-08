import { notFound } from "next/navigation";
import { Suspense } from "react";

import { isE2eMaintenanceHarnessEnabled } from "../../../shared/server/e2e-harness";
import { E2eMaintenanceHarness } from "./harness";

export const dynamic = "force-dynamic";

export default function E2eMaintenancePage() {
  if (!isE2eMaintenanceHarnessEnabled()) {
    notFound();
  }

  return (
    <Suspense>
      <E2eMaintenanceHarness />
    </Suspense>
  );
}
