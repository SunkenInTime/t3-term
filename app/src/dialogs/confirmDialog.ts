// Port of apps/web/src/confirmDialog.ts (logic in ../web/confirmDialog.ts) plus
// the fallback apps/web/src/localApi.ts applies: with no host mounted the
// request resolves false instead of undefined.
import type { ConfirmDialogOptions } from "@t3tools/contracts";

import { requestConfirmDialog as requestThemedConfirmDialog } from "../web/confirmDialog.ts";

export { isConfirmDialogActive } from "../web/confirmDialog.ts";

/**
 * Asks the user to confirm. The message's first line ending in "?" becomes the
 * title and the rest the description; `{ variant: "destructive" }` paints
 * Confirm red. Requests made while one is open queue behind it. Resolves false
 * on Cancel, Escape, or when no dialog host is mounted.
 */
export function requestConfirmDialog(message: string, options?: ConfirmDialogOptions): Promise<boolean> {
  return requestThemedConfirmDialog(message, options) ?? Promise.resolve(false);
}
