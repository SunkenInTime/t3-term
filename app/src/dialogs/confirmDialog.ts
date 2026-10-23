// OWNER: palette/navigation agent. Port of apps/web/src/confirmDialog.ts.
import type { ConfirmDialogOptions } from "@t3tools/contracts";

/** Asks the user to confirm. Resolves false on cancel. Stub until ConfirmDialogHost lands. */
export function requestConfirmDialog(_message: string, _options?: ConfirmDialogOptions): Promise<boolean> {
  return Promise.resolve(false);
}
