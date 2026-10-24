// Signed URLs for attachments already on the server (web useAssetUrls), for the composer's
// queued-message thumbnails and the queued-edit attachment row. Same lookup as the
// timeline's user message rows.
import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { ChatAttachment, EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { environmentSession } from "../../state/environment.ts";
import { timelineAssets } from "../../state/timeline.ts";
import { selectMessageImageResources } from "../../web/session-logic.ts";

const EMPTY_URLS_ATOM = Atom.make<
  ReadonlyArray<ReturnType<typeof timelineAssets.createUrl> extends Atom.Atom<infer R> ? R : never>
>([]);

/** Image attachment id → URL, for the images among `attachments` that the server holds. */
export function useAttachmentImageUrls(
  environmentId: EnvironmentId,
  attachments: ReadonlyArray<ChatAttachment>,
): ReadonlyMap<string, string> {
  const resources = useMemo(() => selectMessageImageResources(attachments as never), [attachments]);
  const prepared = useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId));
  const results = useAtomValue(
    resources.length === 0 ? EMPTY_URLS_ATOM : timelineAssets.createUrls({ environmentId, resources }),
  );
  const httpBaseUrl = Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
  const urls = resources.map((_, index) => {
    const result = results[index];
    if (!result || result._tag !== "Success" || httpBaseUrl === null) return null;
    return resolveAssetUrl(httpBaseUrl, result.value.relativeUrl);
  });
  const key = urls.join("\u0000");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const map = new Map<string, string>();
    resources.forEach((resource, index) => {
      const url = urls[index];
      if (resource._tag === "attachment" && url) map.set(resource.attachmentId, url);
    });
    return map;
  }, [key, resources]);
}
