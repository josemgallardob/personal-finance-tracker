"use client";

/**
 * Create and rename dialog for a tag.
 *
 * Tags have no type. The same name schema the category dialog uses applies
 * here with global uniqueness, so a client conflict and a 409 `duplicateName`
 * render the same Spanish field error.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, type FormEvent } from "react";
import { useForm } from "react-hook-form";

import { createApiClient } from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { Button } from "../../../shared/ui/button";
import { DialogShell } from "../../../shared/ui/dialog";
import { ErrorSummary } from "../../../shared/ui/error-summary";
import { Field } from "../../../shared/ui/field";
import { Input } from "../../../shared/ui/input";
import {
  createClassificationApi,
  type ClassificationApi,
} from "../client/classification-api";
import type { TagDto } from "../contracts/tag";
import {
  classificationFormCopy,
  classificationFormSummary,
  classificationSubmitErrors,
  createTagFormSchema,
  scheduleClassificationAlertFocus,
  renameTagFormSchema,
  tagDialogFields,
  type RenameNameFormValues,
} from "./classification-form";

const defaultClassificationApi = createClassificationApi(createApiClient());

export type TagDialogMode =
  | { readonly kind: "create" }
  | { readonly kind: "rename"; readonly tag: TagDto };

export interface TagDialogProps {
  readonly api?: ClassificationApi;
  readonly existingTags: readonly TagDto[];
  readonly mode: TagDialogMode | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved?: (focusId?: string) => void;
  readonly open: boolean;
}

export function TagDialog({
  api = defaultClassificationApi,
  existingTags,
  mode,
  onOpenChange,
  onSaved,
  open,
}: TagDialogProps) {
  const { announceSuccessfulMutation } = useFinancialDataRevision();
  const formRootRef = useRef<HTMLDivElement>(null);
  const isCreate = mode?.kind !== "rename";
  const tag = mode?.kind === "rename" ? mode.tag : undefined;

  const resolver = useMemo(() => {
    if (isCreate) {
      return zodResolver(createTagFormSchema(existingTags));
    }

    return zodResolver(
      renameTagFormSchema(
        existingTags,
        tag ?? { id: "", name: "", isArchived: false },
      ),
    );
  }, [existingTags, isCreate, tag]);

  const form = useForm<RenameNameFormValues>({
    resolver,
    shouldFocusError: false,
    defaultValues: { name: "" },
  });

  const pending = form.formState.isSubmitting;

  useEffect(() => {
    if (!open) {
      return;
    }

    form.clearErrors();
    form.reset({ name: isCreate ? "" : (tag?.name ?? "") });
  }, [form, isCreate, open, tag?.id, tag?.name]);

  function requestClose() {
    if (pending) {
      return;
    }

    onOpenChange(false);
  }

  async function onValid(values: RenameNameFormValues) {
    const result = isCreate
      ? await api.createTag({ name: values.name })
      : tag === undefined
        ? undefined
        : await api.renameTag(tag.id, { name: values.name });

    if (result === undefined) {
      return;
    }

    if (result.ok) {
      onSaved?.(isCreate ? undefined : tag?.id);
      onOpenChange(false);
      announceSuccessfulMutation();
      return;
    }

    const mapped = classificationSubmitErrors(result, "tag");
    if (mapped.name) {
      form.setError("name", { type: "server", message: mapped.name });
    }
    if (mapped.form) {
      form.setError("root", { type: "server", message: mapped.form });
    }
    scheduleClassificationAlertFocus(formRootRef.current);
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    void form.handleSubmit(onValid, () => {
      scheduleClassificationAlertFocus(formRootRef.current);
    })(event);
  }

  const nameError = form.formState.errors.name?.message;
  const formError = form.formState.errors.root?.message;
  const summary = classificationFormSummary(
    [{ fieldId: tagDialogFields.name, message: nameError }],
    formError,
  );

  return (
    <DialogShell
      description={
        isCreate
          ? classificationFormCopy.createTagDescription
          : classificationFormCopy.renameTagDescription
      }
      footer={
        <>
          <Button disabled={pending} variant="secondary" onClick={requestClose}>
            {classificationFormCopy.cancel}
          </Button>
          <Button form={tagDialogFields.form} pending={pending} type="submit">
            {pending
              ? classificationFormCopy.saving
              : classificationFormCopy.save}
          </Button>
        </>
      }
      open={open}
      preventClose={pending}
      showCloseButton={false}
      title={
        isCreate
          ? classificationFormCopy.createTagTitle
          : classificationFormCopy.renameTagTitle
      }
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          requestClose();
        }
      }}
    >
      <div ref={formRootRef} className="flex flex-col gap-4">
        <ErrorSummary errors={summary} />
        <form
          id={tagDialogFields.form}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={handleFormSubmit}
        >
          <Field
            error={nameError}
            hint={classificationFormCopy.nameHint}
            id={tagDialogFields.name}
            label={classificationFormCopy.nameLabel}
            required
          >
            <Input
              autoComplete="off"
              disabled={pending}
              {...form.register("name")}
            />
          </Field>
        </form>
      </div>
    </DialogShell>
  );
}
