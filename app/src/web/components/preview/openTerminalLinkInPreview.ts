// Ported from apps/web/src/components/preview/openTerminalLinkInPreview.ts.
// web's recordVisitForThread is left out: its browserHistoryStore is not ported
// (see panels/browser/PreviewEmptyState.tsx). OpenPreviewMutation comes from
// apps/web/src/browser/openFileInPreview.ts.
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type AtomCommandResult, isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PreviewOpenInput,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { isPreviewAvailableFor, previewRuntimeFor } from "../../../state/preview.ts";
import { rightPanelActions } from "../../../state/rightPanel.ts";
import {
  browserDefaultOpenProfileId,
  browserDefaultOpenViewport,
  resolveBrowserDefaults,
} from "../../browser/browserDefaults.ts";
import { isWebUrl, resolveBrowserLinkTargetPreference } from "../../browser/browserLinkTarget.ts";
import { applyPreviewServerSnapshot } from "../../previewStateStore.ts";

export type OpenPreviewMutation<E = unknown> = (input: {
  readonly environmentId: EnvironmentId;
  readonly input: PreviewOpenInput;
}) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;

const terminalLinkErrorContext = {
  environmentId: Schema.String,
  threadId: Schema.String,
  targetOrigin: Schema.String,
  cause: Schema.Defect(),
};

export class TerminalLinkPreviewOpenError extends Schema.TaggedError<TerminalLinkPreviewOpenError>()(
  "TerminalLinkPreviewOpenError",
  terminalLinkErrorContext,
) {
  override get message(): string {
    return `Failed to open terminal link ${this.targetOrigin} in preview for thread ${this.threadId}.`;
  }
}

interface OpenTerminalLinkInPreviewInput<E> {
  readonly url: string;
  readonly threadRef: ScopedThreadRef;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly fallbackToBrowser: () => void;
  readonly forceBrowser: boolean;
}

export async function openTerminalLinkInPreview<E>(
  input: OpenTerminalLinkInPreviewInput<E>,
): Promise<void> {
  const supportsPreview =
    !input.forceBrowser &&
    isWebUrl(input.url) &&
    isPreviewAvailableFor(input.threadRef.environmentId) &&
    input.threadRef.threadId.length > 0 &&
    (await resolveBrowserLinkTargetPreference()) === "app";

  if (!supportsPreview) {
    input.fallbackToBrowser();
    return;
  }

  const errorContext = {
    environmentId: input.threadRef.environmentId,
    threadId: input.threadRef.threadId,
    targetOrigin: new URL(input.url).origin,
  };

  const defaults = await resolveBrowserDefaults();
  const runtime = previewRuntimeFor(input.threadRef.environmentId);
  const result = await input.openPreview({
    environmentId: input.threadRef.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      url: input.url,
      viewport: browserDefaultOpenViewport(defaults),
      profileId: browserDefaultOpenProfileId(defaults),
      ...(runtime === undefined ? {} : { runtime }),
    },
  });
  if (result._tag === "Failure") {
    if (isAtomCommandInterrupted(result)) {
      return;
    }
    console.error(
      new TerminalLinkPreviewOpenError({
        ...errorContext,
        cause: result.cause,
      }),
    );
    input.fallbackToBrowser();
    return;
  }
  applyPreviewServerSnapshot(input.threadRef, result.value);
  rightPanelActions.openBrowser(scopedThreadKey(input.threadRef), result.value.tabId);
}
