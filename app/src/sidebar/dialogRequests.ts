// Promise-returning requests for the sidebar's dialogs, rendered by SidebarDialogs.
// Web: apps/web/src/confirmDialog.ts (localApi.dialogs.confirm) and
// CustomSnoozeDialog.tsx (requestCustomSnooze).
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";

export interface ConfirmRequest {
  readonly message: string;
  readonly variant: "default" | "destructive";
  readonly resolve: (confirmed: boolean) => void;
}

export const confirmRequestAtom = Atom.make<ConfirmRequest | null>(null).pipe(Atom.keepAlive);

export function requestConfirm(
  message: string,
  options: { readonly variant?: "default" | "destructive" } = {},
): Promise<boolean> {
  appAtomRegistry.get(confirmRequestAtom)?.resolve(false);
  return new Promise((resolve) => {
    appAtomRegistry.set(confirmRequestAtom, {
      message,
      variant: options.variant ?? "default",
      resolve: (confirmed) => {
        appAtomRegistry.set(confirmRequestAtom, null);
        resolve(confirmed);
      },
    });
  });
}

export type SnoozeChoice = { readonly snoozedUntil: string };

export interface CustomSnoozeRequest {
  readonly resolve: (choice: SnoozeChoice | null) => void;
}

export const customSnoozeRequestAtom = Atom.make<CustomSnoozeRequest | null>(null).pipe(
  Atom.keepAlive,
);

export function requestCustomSnooze(): Promise<SnoozeChoice | null> {
  appAtomRegistry.get(customSnoozeRequestAtom)?.resolve(null);
  return new Promise((resolve) => {
    appAtomRegistry.set(customSnoozeRequestAtom, {
      resolve: (choice) => {
        appAtomRegistry.set(customSnoozeRequestAtom, null);
        resolve(choice);
      },
    });
  });
}

/** apps/web/src/components/ConfirmDialogHost.tsx resolveConfirmDialogCopy. */
export function resolveConfirmDialogCopy(message: string): {
  readonly title: string;
  readonly description: string | null;
} {
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
