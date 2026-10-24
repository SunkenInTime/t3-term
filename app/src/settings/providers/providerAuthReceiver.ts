// What web's desktop bridge does for ChatGPT sign-in against a remote environment
// (desktopBridge.receiveProviderAuthCallback / cancelProviderAuthCallback, backed by
// @t3tools/shared/codexAuthCallback): listen on this computer's loopback callback
// port, open the sign-in page, and hand the redirect the browser lands on back to
// the environment, so nothing has to be pasted. t3-term is a native process like
// the desktop app, so it can run the same receiver.
//
// Over SSH the browser runs on another machine than t3-term, so its redirect would
// never reach this listener; there the remote-web flow (paste the redirect URL) stays.
// Opening the page has the same problem: a browser launched here opens on the SSH
// host, not in front of the user. Web's remote client opens the page in the user's
// own browser; the nearest a terminal session gets is the user's clipboard (OSC 52
// through their terminal), so over SSH the link is copied instead.
//
// Web's "Use T3 desktop for automatic return" handoff does not carry over: its
// helper sends the browser on to the handoff's return URL, which must be a T3 web
// page or the desktop app (providerAuthReturnUrl). No URL reaches t3-term, so the
// sign-in would land in another app; the pasted redirect URL finishes it here.
import { cancelCodexAuthCallback, receiveCodexAuthCallback } from "@t3tools/shared/codexAuthCallback";

import { writeTextToClipboard } from "../../palette/clipboard.ts";
import { toast } from "../../ui/toast.tsx";
import { openExternal } from "../openExternal.ts";

/** t3-term runs on another machine than the user's browser (an SSH session). */
export function isRemoteAuthSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

export function canReceiveProviderAuthCallback(): boolean {
  return !isRemoteAuthSession() && process.env.T3TERM_NO_AUTH_RECEIVER !== "1";
}

/**
 * Puts a sign-in page in front of the user: the system browser locally, the user's
 * clipboard over SSH. Resolves whether the page was opened or the link copied.
 */
export async function presentSignInPage(url: string): Promise<"opened" | "copied" | "failed"> {
  if (!isRemoteAuthSession()) {
    openExternal(url);
    return "opened";
  }
  const copied = await writeTextToClipboard(url).catch(() => false);
  if (copied) {
    toast({
      type: "success",
      title: "Sign-in link copied",
      description: "Open it in your browser, then paste the URL of the final localhost page here.",
    });
    return "copied";
  }
  toast({ type: "error", title: "Couldn't copy the sign-in link", description: url });
  return "failed";
}

/** Resolves with the redirect URL the browser delivered, or rejects (port taken, expired, cancelled). */
export function receiveProviderAuthCallback(authorizationUrl: string): Promise<string> {
  return receiveCodexAuthCallback(authorizationUrl, async (url) => {
    openExternal(url);
    return true;
  });
}

export function cancelProviderAuthCallback(authorizationUrl: string): void {
  try {
    cancelCodexAuthCallback(authorizationUrl);
  } catch {
    // Not a sign-in URL this receiver knows; nothing is listening for it.
  }
}
