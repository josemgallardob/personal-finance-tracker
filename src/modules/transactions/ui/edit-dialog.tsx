"use client";

import type { ApiClient } from "../../../shared/client/api-client";
import { TransactionMutationDialog } from "./transaction-mutation-dialog";

export interface EditTransactionDialogProps {
  readonly client?: ApiClient;
  readonly onCompleted?: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly transactionId: string | null;
}

export function EditTransactionDialog(props: EditTransactionDialogProps) {
  return <TransactionMutationDialog {...props} mode="edit" />;
}
