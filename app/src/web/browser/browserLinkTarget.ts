// Ported from apps/web/src/browser/browserLinkTarget.ts. Client settings come from
// ./clientSettings.ts and preview availability from state/preview.ts.
import type { BrowserLinkTarget, ScopedThreadRef } from "@t3tools/contracts";

import { ensureClientSettingsHydrated, getClientSettings } from "./clientSettings.ts";
import { isPreviewAvailableFor } from "../../state/preview.ts";

export interface ResolveLinkTargetInput {
  readonly url: string;
  readonly event: {
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
    readonly button?: number | undefined;
  };
  readonly preference: BrowserLinkTarget;
  readonly canOpenInApp: boolean;
}

export function resolveLinkTarget(input: ResolveLinkTargetInput): BrowserLinkTarget {
  if (input.event.metaKey || input.event.ctrlKey || input.event.button === 1) return "system";
  if (input.preference !== "app") return "system";
  if (!input.canOpenInApp) return "system";
  if (!isWebUrl(input.url)) return "system";
  return "app";
}

export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Before hydration the snapshot is the schema default ("system"), so a link clicked in the
 * first moments after launch would ignore a persisted "app" — opening is asynchronous anyway,
 * so waiting costs nothing the user can see.
 */
export async function resolveBrowserLinkTargetPreference(): Promise<BrowserLinkTarget> {
  await ensureClientSettingsHydrated();
  return getClientSettings().browserLinkTarget;
}

export function canOpenLinksInApp(threadRef: ScopedThreadRef | null | undefined): boolean {
  return threadRef != null && isPreviewAvailableFor(threadRef.environmentId);
}
