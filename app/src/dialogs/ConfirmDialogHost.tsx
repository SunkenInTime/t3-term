// Port of apps/web/src/components/ConfirmDialogHost.tsx: the alert dialog behind
// requestConfirmDialog. Title/description split, Cancel + Confirm, destructive
// variant.
import { useEffect, useSyncExternalStore } from "react";

import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  registerConfirmDialogHost,
  respondToConfirmDialog,
  subscribeConfirmDialog,
} from "../web/confirmDialog.ts";
import { Button } from "../ui/primitives.tsx";
import { DIALOG_WIDTH, DialogFooter, DialogHeader, DialogShell } from "./dialogKit.tsx";

type ConfirmationCopy = {
  readonly title: string;
  readonly description: string | null;
};

function resolveConfirmDialogCopy(message: string): ConfirmationCopy {
  const normalizedMessage = message.trim();
  const lines = normalizedMessage.split("\n");
  const questionLineIndex = lines.findIndex((line) => line.trim().endsWith("?"));

  if (questionLineIndex >= 0) {
    const title = lines[questionLineIndex]!.trim();
    const description = lines
      .filter((_, index) => index !== questionLineIndex)
      .join("\n")
      .trim();
    return { title, description: description || null };
  }

  const questionMarkIndex = normalizedMessage.indexOf("?");
  if (questionMarkIndex >= 0) {
    return {
      title: normalizedMessage.slice(0, questionMarkIndex + 1).trim(),
      description: normalizedMessage.slice(questionMarkIndex + 1).trim() || null,
    };
  }

  return {
    title: "Confirm action",
    description: normalizedMessage || "This action requires your confirmation.",
  };
}

export function ConfirmDialogHost() {
  const state = useSyncExternalStore(
    subscribeConfirmDialog,
    readConfirmDialogState,
    readConfirmDialogState,
  );

  useEffect(() => registerConfirmDialogHost(), []);

  // Web finishes the close after its exit animation; gpuix has none, so the
  // next queued confirmation can open on the following commit.
  useEffect(() => {
    if (state.status === "closing") completeConfirmDialogClose();
  }, [state]);

  if (state.status !== "confirming") return null;
  const copy = resolveConfirmDialogCopy(state.message);
  const onCancel = () => respondToConfirmDialog(false);
  const onConfirm = () => respondToConfirmDialog(true);

  return (
    <DialogShell
      width={DIALOG_WIDTH.lg}
      testId="confirm-dialog"
      showCloseButton={false}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogHeader title={copy.title} description={copy.description} hasPanel={false} />
      <DialogFooter>
        <Button variant="outline" testId="confirm-dialog-cancel" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={state.variant === "destructive" ? "destructive" : "default"}
          testId="confirm-dialog-confirm"
          onClick={onConfirm}
        >
          Confirm
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}
