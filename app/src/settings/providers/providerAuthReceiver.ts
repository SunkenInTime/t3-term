// What web's desktop bridge does for ChatGPT sign-in against a remote environment
// (desktopBridge.receiveProviderAuthCallback / cancelProviderAuthCallback, backed by
// @t3tools/shared/codexAuthCallback): listen on this computer's loopback callback
// port, open the sign-in page, and hand the redirect the browser lands on back to
// the environment, so nothing has to be pasted. t3-term is a native process like
// the desktop app, so it can run the same receiver.
//
// Over SSH the browser runs on another machine than t3-term, so its redirect would
// never reach this listener; there the remote-web flow (paste the redirect URL) stays.
import { cancelCodexAuthCallback, receiveCodexAuthCallback } from "@t3tools/shared/codexAuthCallback";

import { openExternal } from "../openExternal.ts";

export function canReceiveProviderAuthCallback(): boolean {
  return !process.env.SSH_CONNECTION && !process.env.SSH_TTY && process.env.T3TERM_NO_AUTH_RECEIVER !== "1";
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
