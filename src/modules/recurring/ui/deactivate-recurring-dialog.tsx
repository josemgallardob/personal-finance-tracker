"use client";

import { useMemo, useRef, useState } from "react";

import {
  createApiClient,
  type ApiClient,
} from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { useResource } from "../../../shared/client/use-resource";
import { Button } from "../../../shared/ui/button";
import { DialogShell } from "../../../shared/ui/dialog";
import { LoadingState } from "../../../shared/ui/loading-state";
import { createRecurringApi } from "../client/recurring-api";
import type { RecurringRuleDto } from "../contracts/recurring";
import { recurringCopy } from "./recurring-copy";
import { recurringFailureMessage } from "./recurring-failure";
import { catchUpAnnouncement } from "./recurring-presentation";

export interface DeactivateRecurringDialogProps {
  readonly client?: ApiClient;
  /** Name of the rule, so the confirmation identifies what it stops. */
  readonly label: string;
  readonly onCompleted?: (generatedDueDates: readonly string[]) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly rule: RecurringRuleDto | null;
}

/**
 * Confirms the irreversible stop of one active template.
 *
 * Cancelling never calls the API, so a rule the owner decided to keep is
 * exactly as it was. Confirming states beforehand that the MVP cannot undo the
 * deactivation and which overdue dates it will recover first, because both
 * happen in the same write and the owner cannot inspect them afterwards.
 */
export function DeactivateRecurringDialog({
  client,
  label,
  onCompleted,
  onOpenChange,
  open,
  rule,
}: DeactivateRecurringDialogProps) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const api = useMemo(() => createRecurringApi(apiClient), [apiClient]);
  const { announceSuccessfulMutation } = useFinancialDataRevision();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ruleId = rule?.id ?? null;
  const catchUp = useResource({
    enabled: open && ruleId !== null,
    requestKey: `recurring-deactivate-catch-up:${ruleId ?? ""}`,
    revision: 0,
    refreshEpoch: 0,
    load: (signal) => {
      if (ruleId === null) {
        return Promise.resolve({
          ok: false as const,
          reason: "invalidResponse" as const,
          status: 204,
        });
      }

      return api.previewCatchUp(ruleId, { signal });
    },
  });

  function requestClose() {
    if (pendingRef.current) {
      return;
    }

    setError(null);
    onOpenChange(false);
  }

  async function confirm(): Promise<void> {
    if (pendingRef.current || rule === null) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setError(null);

    const result = await api.deactivateRule(rule.id, {
      templateVersion: rule.templateVersion,
    });

    pendingRef.current = false;
    setPending(false);

    if (!result.ok) {
      if (result.reason !== "aborted") {
        setError(
          recurringFailureMessage(result, recurringCopy.deactivateError),
        );
      }
      return;
    }

    announceSuccessfulMutation();
    onCompleted?.(result.noContent ? [] : result.data.generatedDueDates);
    onOpenChange(false);
  }

  const catchUpMessage = catchUpAnnouncement(
    catchUp.data?.pendingDueDates ?? [],
  );

  return (
    <DialogShell
      description={recurringCopy.deactivateDescription}
      footer={
        <>
          <Button disabled={pending} variant="secondary" onClick={requestClose}>
            {recurringCopy.cancel}
          </Button>
          <Button
            pending={pending}
            variant="danger"
            onClick={() => {
              void confirm();
            }}
          >
            {recurringCopy.deactivateConfirm}
          </Button>
        </>
      }
      open={open}
      preventClose={pending}
      showCloseButton={false}
      title={recurringCopy.deactivateTitle}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          requestClose();
        }
      }}
    >
      <div className="flex w-full max-w-full flex-col gap-3">
        <p className="text-body text-text font-medium">{label}</p>
        <p className="text-body-sm text-text-muted">
          {recurringCopy.deactivateIrreversible}
        </p>
        {catchUp.status === "loading" ? (
          <LoadingState label={recurringCopy.catchUpLoading} />
        ) : catchUp.status === "error" ? (
          <p className="text-body-sm text-text-muted" role="status">
            {recurringCopy.catchUpUnavailable}
          </p>
        ) : (
          <p className="text-body-sm text-text" role="status">
            {catchUpMessage ?? recurringCopy.catchUpNone}
          </p>
        )}
        {error ? (
          <p className="text-body-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </DialogShell>
  );
}
