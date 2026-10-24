// `t3-term --open <link>`: where a T3 Code prompt link points. Web gets these as routes
// (`/new?...` is routes/_chat.new.tsx, a thread URL with `?prompt=` is ThreadLinkPrompt.tsx);
// the desktop app turns `t3code://` deep links and hosted-app URLs into those routes with
// promptLinkAppPath. t3-term has no URLs, so it reads the same shapes from the command line.
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { promptLinkAppPath } from "@t3tools/shared/promptLinks";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { routeAtom } from "../state/ui.ts";

export type PromptLinkTarget =
  | { readonly kind: "new"; readonly search: string }
  | {
      readonly kind: "thread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly search: string;
    }
  | { readonly kind: "invalid" };

const THREAD_PATH = /^\/([^/]+)\/([^/]+)\/?$/;
const BASE = "https://app.invalid";

/**
 * Accepts what promptLinkAppPath accepts (`t3code://new?...`, `t3code://threads/<env>/<thread>?...`,
 * the hosted app's URLs), a bare app path (`/new?...`, `/<env>/<thread>?...`), and the same paths
 * on any other origin: whoever passes a link on the command line names the server they mean, so
 * a link copied from a self-hosted or local web client opens too.
 */
export function readPromptLinkTarget(value: string): PromptLinkTarget {
  const trimmed = value.trim();
  const appPath =
    promptLinkAppPath(trimmed) ??
    (trimmed.startsWith("/")
      ? trimmed
      : /^https?:\/\//i.test(trimmed) && URL.canParse(trimmed)
        ? (({ pathname, search }) => `${pathname}${search}`)(new URL(trimmed))
        : null);
  if (appPath === null || !URL.canParse(appPath, BASE)) return { kind: "invalid" };
  const url = new URL(appPath, BASE);
  if (url.pathname === "/new" || url.pathname === "/new/") return { kind: "new", search: url.search };
  const thread = THREAD_PATH.exec(url.pathname);
  if (!thread?.[1] || !thread[2]) return { kind: "invalid" };
  try {
    return {
      kind: "thread",
      environmentId: decodeURIComponent(thread[1]) as EnvironmentId,
      threadId: decodeURIComponent(thread[2]) as ThreadId,
      search: url.search,
    };
  } catch {
    return { kind: "invalid" };
  }
}

let nextLinkKey = 1;

/**
 * Shows the link's landing. Each open gets its own key, the way each web navigation gets its own
 * location key: going back to a landing that already opened shows "This link is open" instead of
 * opening it twice.
 */
export function openPromptLink(link: string): void {
  appAtomRegistry.set(routeAtom, { kind: "prompt-link", link, key: nextLinkKey++ });
}
