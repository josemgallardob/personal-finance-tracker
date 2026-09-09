"use client";

import { useMemo, useState } from "react";

import {
  createApiClient,
  type ApiClient,
  type ApiClientFailure,
} from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { useResource } from "../../../shared/client/use-resource";
import { Button } from "../../../shared/ui/button";
import { ConfirmDialog } from "../../../shared/ui/confirm-dialog";
import { createDemoApi } from "../client/demo-api";
import { createPreferencesApi } from "../client/preferences-api";
import {
  DEMO_APPLICATION_MODE,
  type ApplicationMode,
} from "../contracts/preferences";

export const demoCopy = {
  banner: "Datos de demostración",
  enter: "Explorar datos de demostración",
  enterDescription: "Explora ejemplos sin modificar tus datos personales.",
  exit: "Salir de la demostración",
  reset: "Reiniciar demostración",
  resetCancel: "Cancelar",
  resetConfirm: "Reiniciar demostración",
  resetDescription:
    "Se restaurarán los datos ficticios originales. Tus datos personales no cambiarán.",
  resetTitle: "¿Reiniciar los datos de demostración?",
  requestError: "No se ha podido completar la acción. Vuelve a intentarlo.",
} as const;

export interface DemoActionsProps {
  readonly client?: ApiClient;
  /** Test seam for the hard reload that discards mode-scoped view state. */
  readonly reload?: () => void;
}

function defaultReload(): void {
  window.location.reload();
}

function failureMessage(failure: ApiClientFailure): string {
  return failure.reason === "api"
    ? failure.error.message
    : demoCopy.requestError;
}

/** Starts the isolated demo session from a personal session. */
export function EnterDemoAction({
  client,
  reload = defaultReload,
}: DemoActionsProps) {
  return (
    <ModeAction
      client={client}
      label={demoCopy.enter}
      mode={DEMO_APPLICATION_MODE}
      reload={reload}
    />
  );
}

/** Returns a demo session to the pre-existing personal database. */
export function ExitDemoAction({
  client,
  reload = defaultReload,
}: DemoActionsProps) {
  return (
    <ModeAction
      client={client}
      label={demoCopy.exit}
      mode="personal"
      reload={reload}
      variant="secondary"
    />
  );
}

function ModeAction({
  client,
  label,
  mode,
  reload,
  variant = "primary",
}: DemoActionsProps & {
  readonly label: string;
  readonly mode: ApplicationMode;
  readonly reload: () => void;
  readonly variant?: "primary" | "secondary";
}) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function changeMode() {
    setError(null);
    setPending(true);
    const result = await createDemoApi(apiClient).setMode(mode);
    setPending(false);

    if (!result.ok) {
      setError(failureMessage(result));
      return;
    }

    reload();
  }

  return (
    <div className="flex max-w-full flex-col items-start gap-2">
      <Button
        pending={pending}
        variant={variant}
        onClick={() => void changeMode()}
      >
        {label}
      </Button>
      {error ? (
        <p className="text-body-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Confirms a reproducible reset that is available only in demo mode. */
export function ResetDemoDialog({
  client,
  reload = defaultReload,
}: DemoActionsProps) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function resetDemo() {
    setError(undefined);
    setPending(true);
    const result = await createDemoApi(apiClient).reset();
    setPending(false);

    if (!result.ok) {
      setError(failureMessage(result));
      return;
    }

    setOpen(false);
    reload();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {demoCopy.reset}
      </Button>
      <ConfirmDialog
        cancelLabel={demoCopy.resetCancel}
        confirmLabel={demoCopy.resetConfirm}
        confirmVariant="primary"
        description={demoCopy.resetDescription}
        error={error}
        open={open}
        pending={pending}
        title={demoCopy.resetTitle}
        onCancel={() => setError(undefined)}
        onConfirm={() => void resetDemo()}
        onOpenChange={setOpen}
      />
    </>
  );
}

/**
 * Global mode affordance. It reads the server-selected mode and reloads after
 * any mode mutation so every mounted resource and visual selection starts in
 * the correct isolated context.
 */
export function DemoModeControls({
  client,
  reload = defaultReload,
}: DemoActionsProps) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const { revision, refreshEpoch } = useFinancialDataRevision();
  const preferences = useResource({
    requestKey: "preferences:mode",
    revision,
    refreshEpoch,
    load: (signal) =>
      createPreferencesApi(apiClient).getPreferences({ signal }),
  });

  if (preferences.data?.mode === DEMO_APPLICATION_MODE) {
    return (
      <section
        aria-label={demoCopy.banner}
        className="border-primary bg-surface-raised flex w-full max-w-full flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
        role="status"
      >
        <div>
          <p className="text-body font-semibold">{demoCopy.banner}</p>
          <p className="text-body-sm text-text-muted">
            {demoCopy.resetDescription}
          </p>
        </div>
        <div className="flex max-w-full flex-col gap-2 sm:flex-row">
          <ResetDemoDialog client={apiClient} reload={reload} />
          <ExitDemoAction client={apiClient} reload={reload} />
        </div>
      </section>
    );
  }

  if (preferences.data?.mode === "personal") {
    return (
      <section className="border-border bg-surface-raised flex w-full max-w-full flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-text-muted">
          {demoCopy.enterDescription}
        </p>
        <EnterDemoAction client={apiClient} reload={reload} />
      </section>
    );
  }

  return null;
}
