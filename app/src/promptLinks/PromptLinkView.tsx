// The `prompt-link` route: what web's router does with a link. `/new?...` is
// routes/_chat.new.tsx (parse, then NewThreadLinkView or "Could not open the link"); a thread
// URL is the thread route plus ThreadLinkPrompt.tsx, which puts `?prompt=` into that thread's
// composer. Anything else is a link t3-term cannot read.
import { parseNewThreadLink, parseThreadLinkPrompt } from "@t3tools/shared/promptLinks";
import { useEffect, useMemo, useRef } from "react";

import { openThread } from "../palette/actions.ts";
import { toast } from "../ui/toast.tsx";
import { LinkPage } from "./LinkPage.tsx";
import { placeLinkedPrompt } from "./linkedPrompt.ts";
import { NewThreadLinkView } from "./NewThreadLinkView.tsx";
import { readPromptLinkTarget } from "./promptLinkTarget.ts";

export function PromptLinkView({ link, linkKey }: { readonly link: string; readonly linkKey: number }) {
  const target = useMemo(() => readPromptLinkTarget(link), [link]);
  if (target.kind === "invalid") {
    return <LinkPage title="Could not open the link" description="This is not a T3 Code link." />;
  }
  if (target.kind === "thread") {
    return <ThreadLink environmentId={target.environmentId} threadId={target.threadId} search={target.search} />;
  }
  const parsed = parseNewThreadLink(target.search);
  if (!parsed.ok) return <LinkPage title="Could not open the link" description={parsed.error} />;
  return <NewThreadLinkView link={parsed.value} linkKey={linkKey} />;
}

/** ThreadLinkPrompt: place the prompt, then show the thread (web strips the params instead). */
function ThreadLink({
  environmentId,
  threadId,
  search,
}: {
  readonly environmentId: Parameters<typeof openThread>[0]["environmentId"];
  readonly threadId: Parameters<typeof openThread>[0]["threadId"];
  readonly search: string;
}) {
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (new URLSearchParams(search).has("prompt")) {
      const parsed = parseThreadLinkPrompt(search);
      if (!parsed.ok) {
        toast({ type: "error", title: "Could not open the linked prompt", description: parsed.error });
      } else if (parsed.value !== null) {
        placeLinkedPrompt({ kind: "thread", environmentId, threadId }, parsed.value);
      }
    }
    openThread({ environmentId, threadId });
  }, [environmentId, threadId, search]);
  return <LinkPage title="Opening the link..." />;
}
