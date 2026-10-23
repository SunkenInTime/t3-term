// apps/web/src/components/ChatView.tsx (pendingHandoff): once the composer picks a provider
// the thread's context has to be handed to, the timeline footer says so before the next send.
import { useAtomValue } from "@effect/atom-react";
import { resolvePendingHandoff } from "@t3tools/client-runtime/handoff";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { composerDraftAtom, composerSettingsAtom, composerTargetKey } from "../../state/composer.ts";
import { environmentThreadDetails, environmentThreadShells, serverEnvironment } from "../../state/environment.ts";
import { applyProviderInstanceSettings, deriveProviderInstanceEntries } from "../../web/providerInstances.ts";
import { HandoffRow } from "./EventRows.tsx";

export function PendingHandoffRow(props: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = props.threadRef;
  const draft = useAtomValue(composerDraftAtom(composerTargetKey({ kind: "thread", environmentId, threadId })));
  const shell = useAtomValue(environmentThreadShells.threadShellAtom(props.threadRef));
  const projection = useAtomValue(environmentThreadDetails.quietThreadAtom(props.threadRef))?.projection ?? null;
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? [];
  const settings = useAtomValue(composerSettingsAtom(environmentId));
  const composerSelection = draft.activeProvider ? (draft.modelSelectionByProvider[draft.activeProvider] ?? null) : null;
  const selection = composerSelection ?? shell?.modelSelection ?? null;
  const selectionUsable =
    selection !== null &&
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, shell?.projectId ?? null).some(
      (entry) => entry.instanceId === selection.instanceId && entry.enabled && entry.isAvailable,
    );
  const endpoints = resolvePendingHandoff(projection, selectionUsable ? selection : null, providers);
  if (endpoints === null) return null;
  return (
    <div testId="pending-handoff">
      <HandoffRow environmentId={environmentId} endpoints={endpoints} pending />
    </div>
  );
}
