// The composer: port of apps/web/src/components/chat/ChatComposer.tsx and the ChatView
// wiring it depends on (provider/model resolution, send, interrupt, resume, plan follow-up).
//
// Layout (ChatComposer.tsx:3412-3990, spec C4):
//   banner dock (approvals, questions, plan follow-up, queued runs) overlapping 17px
//   surface: radius 22, #111 glass (opaque here: GPUI has no backdrop blur), white/5 outline
//     body  pt 16 px 16 pb 8: attachments, editor 14/23 (min 3 rows), command menu above
//     footer px 16 pb 16: model · traits · mode … attach · meter · send
//   context strip below (new-thread drafts) or the resting model strip
//
// The prompt editor is editor/ComposerEditor.tsx (web's Tiptap editor: inline chips, code
// blocks). It hands composer-level keys here first (web useComposerCommandKey):
//   Enter or Tab                        → select the highlighted menu item
//   Up / Down, Ctrl+N/J, Ctrl+P/K       → move the menu highlight
//   Shift+Tab                           → move the highlight up while the menu is open,
//                                         otherwise toggle Build/Plan (web parity)
//   Escape                              → dismiss the menu
//   Enter                               → send; Shift+Enter is a new line (the editor's)
// Modified Enter follows web composerSubmissionIntentForKey (alternate while running,
// background in a draft, send-and-new in a thread). Other composer chords (effort, mode,
// stash, branch, workspace, queue edit/steer) reach the window dispatcher, and this
// composer claims them with registerShortcutHandler.
import { composerInsetAtom, restoredPromptAtom } from "../../state/timeline.ts";
import { ChatLane, useDetailsCardInline } from "../chatLane.tsx";
import { newThreadContextRequestAtom } from "../../state/sidebar.ts";
import { useAtomValue } from "@effect/atom-react";
import { useGpuixRequired, useWindowSize, type KeyEvent } from "@gpuix/react";
import {
  type ComposerDispatchMode,
  resolveComposerDispatchMode,
} from "@t3tools/client-runtime/state/composer-dispatch";
import { resolveProviderSkillsForCwd, resolveProviderSlashCommandsForCwd } from "@t3tools/client-runtime/providerSkills";
import {
  deriveProviderSubagentStatus,
  deriveReportedModelSelection,
  deriveThreadActivityRun,
  formatModelSelectionEffort,
  deriveThreadStructureRuntime,
  threadRuntimeHasInterruptibleRun,
} from "@t3tools/client-runtime/state/thread-execution";
import { threadSupportsProviderHandoff } from "@t3tools/client-runtime/state/thread-workflows";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  isProviderNativeSubagentThread,
  MessageId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ModelSelection,
  type ProjectId,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { createModelSelection } from "@t3tools/shared/model";
import { proposedPlanTitle } from "@t3tools/shared/proposedPlanText";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import {
  type ComposerAttachmentDraft,
  type ComposerTarget,
  addComposerAttachments,
  composerDraftAtom,
  optimisticMessagesAtom,
  removeOptimisticMessages,
  focusComposer,
  restoreComposerContent,
  setDraftWorkspace,
  composerEffortStepAtom,
  composerFocusRequestAtom,
  composerMenuOpenAtom,
  composerSettingsAtom,
  composerTargetKey,
  readComposerDraft,
  referencedReviewComments,
  referencedTerminalContexts,
  referencedThreadContexts,
  registerComposerInsertionHandler,
  citationCommentRequestAtom,
  addComposerThreadContext,
  removeComposerAttachment,
  setComposerInteractionMode,
  setComposerModelOptions,
  setComposerModelSelection,
  setComposerPrompt,
  setComposerRuntimeMode,
  stepComposerEffort,
  stickyModelAtom,
} from "../../state/composer.ts";
import {
  environmentSession,
  environmentThreadDetails,
  environmentThreadShells,
  environmentThreads,
  projectIndexAtom,
  serverEnvironment,
  threadEnvironment,
} from "../../state/environment.ts";
import { modelPickerOpenAtom, routeAtom } from "../../state/ui.ts";
import { toast } from "../../ui/toast.tsx";
import { FONTS, LAYOUT, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { Icon } from "../../ui/Icon.tsx";
import { chatLanePadding, useSmallViewport } from "../../ui/viewport.tsx";
import { Text } from "../../ui/primitives.tsx";
import {
  type ComposerSubmissionIntent,
  type ComposerTrigger,
  detectComposerTrigger,
  extendReplacementRangeForTrailingSpace,
  parseStandaloneComposerSlashCommand,
  replaceTextRange,
} from "../../web/composer-logic.ts";
import { DISCONNECTED_COMPOSER_PLACEHOLDER } from "../../web/composerPlaceholder.ts";
import {
  deriveComposerSendState,
  deriveLockedProvider,
  formatOutgoingPrompt,
  getAntigravitySendBlockReason,
  getStartedThreadModelChangeBlockReason,
  makeModelDisabledReason,
  resolveComposerInteractionMode,
  shouldShowPlanFollowUpPrompt,
  threadShellHasStarted,
} from "../../web/components/ChatView.logic.ts";
import type { ComposerCommandItem } from "../../web/components/chat/ComposerCommandMenu.ts";
import { resolveComposerMenuActiveItemId } from "../../web/components/chat/composerMenuHighlight.ts";
import {
  getComposerPromptInjectionState,
  getComposerReasoningStep,
  withImplicitFastModeDefault,
} from "../../web/components/chat/composerProviderState.ts";
import { getComposerSubmissionValidationMessage } from "../../web/components/chat/composerSubmission.ts";
import {
  providerSupportsManualCompaction,
  resolveContextWindowModelDisplayName,
} from "../../web/components/chat/ContextWindowMeter.logic.ts";
import { readPromptUltrathink, shouldRenderTraitsControls } from "../../web/components/chat/TraitsPicker.logic.ts";
import {
  shouldUseCompactComposerFooter,
  shouldUseCompactComposerPrimaryActions,
} from "../../web/components/composerFooterLayout.ts";
import { runtimeModeConfig, runtimeModeOptions as runtimeModes } from "../../web/components/chat/runtimeModeConfig.ts";
import { deriveLatestContextWindowSnapshot, latestProviderTurnTokenUsage } from "../../web/lib/contextWindow.ts";
import { type AppModelOption, getAppModelOptionsForInstance, resolveAppModelSelectionForInstance } from "../../web/modelSelection.ts";
import { shortcutLabelForCommand } from "../../web/keybindings.ts";
import { getProviderModelCapabilities } from "../../web/providerModels.ts";
import { resolvePlanFollowUpSubmission } from "../../web/proposedPlan.ts";
import {
  deriveActivePlanState,
  derivePhase,
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestRunSettled,
  selectComposerTasksPlan,
} from "../../web/session-logic.ts";
import { resolveThreadSyncPhase } from "../../web/threadSync.ts";
import { deriveTimelineEntriesFromVisibleTurnItems } from "../../web/session-logic.ts";
import {
  type ComposerPromptHistoryPosition,
  buildComposerPromptHistoryEntries,
  stepComposerPromptHistory,
} from "../../web/components/chat/composerPromptHistory.ts";
import { useDelayedStatus } from "../../web/hooks/useDelayedStatus.ts";
import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import { BranchToolbar } from "./BranchToolbar.tsx";
import {
  ComposerAttachButton,
  ComposerAttachmentFileList,
  ComposerAttachmentMediaRow,
} from "./ComposerAttachmentStrip.tsx";
import { ComposerTopBanners } from "./ComposerBanner.tsx";
import { ComposerCommandMenu, ComposerCommandMenuLayer } from "./ComposerCommandMenu.tsx";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu.tsx";
import { ComposerControlSeparator } from "./ComposerControl.tsx";
import { type ComposerControlBlockDef, ComposerControlsBar, hiddenComposerControlBlockIds } from "./ComposerControlsBar.tsx";
import { ComposerFooterModeControls, type RuntimeModeOption } from "./ComposerFooterControls.tsx";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions.tsx";
import {
  composerSendErrorAtom,
  composerSendingAtom,
  interruptComposerTurn,
  sendComposerMessage,
  type ComposerSendTarget,
} from "./composerSend.ts";
import { attachmentsFromPaths } from "./composerAttachmentPaths.ts";
import { readClipboardAttachmentPaths, writePastedTextFile } from "./clipboardAttachments.ts";
import {
  nextPastedTextFileName,
  pastedTextDisposition,
  wouldTextPasteExceedLimit,
} from "@t3tools/client-runtime/text-paste";
import { ContextWindowMeter } from "./ContextWindowMeter.tsx";
import { MODEL_PICKER_TRIGGER_MIN_WIDTH, ProviderModelPicker } from "./ProviderModelPicker.tsx";
import { QueuedRunsControl } from "./QueuedRunsControl.tsx";
import {
  registerShortcutHandler,
  registerTypeToFocusHandler,
  resolveKeyEventCommand,
} from "../../keybindings/useGlobalKeybindings.ts";
import { isConfirmDialogActive } from "../../dialogs/confirmDialog.ts";
import { readClipboardText } from "../../terminal/clipboard.ts";
import { composerFocusAtom, terminalFocusAtom } from "../../state/keybindings.ts";
import { deriveThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import type { KeybindingCommand } from "@t3tools/contracts";
import { TraitsMenuContent, TraitsPicker } from "./TraitsPicker.tsx";
import { type ComposerControlsMeasurer, useComposerControlsLayout } from "./useComposerControlsLayout.ts";
import { resolveComposerProviderModel } from "./useComposerProviderModel.ts";
import { useComposerMenuItems } from "./useComposerMenuItems.ts";
import { ComposerStashBadge, ComposerStashMenu } from "./ComposerStash.tsx";
import { useComposerStash } from "./useComposerStash.ts";
import { sendQueuedRunNow } from "./QueuedRunsControl.tsx";
import { usePendingThreadRequests } from "./usePendingThreadRequests.ts";
import { useQueuedRunEdit } from "./useQueuedRunEdit.ts";
import { composerRestingAtom } from "./composerResting.ts";
import { useComposerBannerItems } from "./useComposerBannerItems.tsx";
import { filterTerminalContextsWithText, type TerminalContextDraft } from "../../web/lib/terminalContext.ts";
import {
  ComposerEditor,
  type ComposerEditorHandle,
  type ComposerEditorKeyContext,
  consumeComposerSinkPasteKeystroke,
  typedText,
} from "./editor/ComposerEditor.tsx";
import type { ComposerChipEnvironment } from "./editor/ComposerInlineChip.tsx";
import {
  reviewCommentContextId,
  terminalContextReference,
  threadContextRecord,
  threadContextReference,
} from "../../web/lib/composerContextRecords.ts";
import { formatInlineContextReference } from "../../web/lib/composerContextReferences.ts";
import { rightPanelActions, threadKeyOf } from "../../state/rightPanel.ts";
import { ThreadContextDragGhost } from "./threadContextDrag.tsx";
import {
  draftFanoutSelectionsAtom,
  type MultipleModelTarget,
  multipleModelSendBlock,
  resolveMultipleModelTargets,
  sendToMultipleModels,
} from "./multipleModelSend.ts";
import { resolveModelPickerSelectedModel } from "../../web/components/chat/ModelPickerContent.logic.ts";
import { useEnvironmentQuery } from "../../palette/hooks.ts";
import { vcsEnvironment } from "../../state/git.ts";
import { ProviderSubagentBar } from "./ProviderSubagentBar.tsx";
import { formatModelSlugName, resolveSelectableModel } from "@t3tools/shared/model";
import { getTriggerDisplayModelName } from "../../web/components/chat/providerIconUtils.ts";
import { shouldShowInstanceBadge } from "../../web/providerInstances.ts";
import { useProjectCloneBanner } from "./useProjectCloneBanner.tsx";
import { composerProviderStatusAtom } from "./composerProviderStatus.ts";
import { DEV_TERMINAL_CONTEXT, devComposerTasks, withDevProviderStatus } from "./devComposerBanners.ts";
import { addTerminalContextToThreadComposer } from "./terminalContextIntake.ts";
import { feedbackUploadsInFlight, upsertFeedbackSubmission } from "./ComposerFeedback.tsx";
import { parseCodexFeedbackCommand, submitCodexFeedback } from "@t3tools/client-runtime/state/threads";
import { isUsageLimitsCommand, USAGE_LIMITS_COMMAND } from "@t3tools/shared/usageLimits";
import { mentionDragOverAtom, reportComposerDropZone } from "../../panels/files/fileTreeActions.ts";

export type { ComposerTarget } from "../../state/composer.ts";

/** web restingBlockDefs ids, in footer order. */
const CONTROL_BLOCKS_WITH_TRAITS = ["traits", "mode"] as const;
const CONTROL_BLOCKS_WITHOUT_TRAITS = ["mode"] as const;
/** `@max-[640px]/composer-surface`: the resting strip's picker drops its label at or under this. */
const RESTING_PICKER_LABEL_MAX_SURFACE_PX = 640;
/** Tailwind `sm`: web's footer drops its gap from this viewport width up. */
const SM_BREAKPOINT = 640;

const NO_TERMINAL_CONTEXTS: ReadonlyArray<TerminalContextDraft> = [];
const NO_THREAD_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null);
const NO_THREAD_STATUS_ATOM = Atom.make<EnvironmentThreadStatus>("live");
const NO_THREAD_STATE_ATOM = Atom.make(
  AsyncResult.initial() as ReturnType<typeof environmentThreads.stateAtom> extends Atom.Atom<infer T> ? T : never,
);

const ALL_RUNTIME_MODE_OPTIONS: ReadonlyArray<RuntimeModeOption> = runtimeModes.map((mode) => ({
  mode,
  ...runtimeModeConfig[mode],
}));
const NO_SKILLS: ServerProvider["skills"] = [];
const NO_SLASH_COMMANDS: ServerProvider["slashCommands"] = [];
const DEFAULT_PLACEHOLDER = "Ask anything, @tag files/folders, $use skills, or / for commands";
const PROMPT_LINE_HEIGHT = 23;

/** Whether a focused element id is a native text field, by id (ids are never reused). */
const editableById = new Map<number, boolean>();

/**
 * True when focus sits on an editable element still on screen: a native <input> or
 * <textarea>, or this composer's editor (web TYPE_TO_FOCUS_EDITABLE_SELECTOR). GPUI keeps
 * the id of a focused element after it unmounts, and focuses the row or control a click
 * landed on, so neither a bare id nor "something is focused" means the keys have a home.
 * Surfaces that take keys themselves (terminal, browser, device stream, file tree) stop or
 * prevent them before the window sees them.
 */
function hasEditableFocus(renderer: unknown, editorId: number | null): boolean {
  const host = renderer as
    | { getFocusedElementId?: () => number | null; getElementBounds?: (id: number) => unknown; getAutomationTree?: () => string }
    | undefined;
  const id = host?.getFocusedElementId?.();
  if (id === null || id === undefined) return false;
  if (id === editorId) return true;
  if (host?.getElementBounds && host.getElementBounds(id) == null) return false;
  let editable = editableById.get(id);
  if (editable === undefined) {
    editable = false;
    try {
      const find = (node: { id?: number; type?: string; children?: unknown[] }): string | null => {
        if (node.id === id) return node.type ?? null;
        for (const child of (node.children ?? []) as Array<typeof node>) {
          const type = find(child);
          if (type !== null) return type;
        }
        return null;
      };
      const type = host?.getAutomationTree ? find(JSON.parse(host.getAutomationTree())) : "input";
      editable = type === "input" || type === "textarea";
    } catch {
      editable = true;
    }
    editableById.set(id, editable);
  }
  return editable;
}

/** Mixes `color` over `base` at `amount`, for opaque stand-ins of web's translucent glass. */
function mix(color: string, base: string, amount: number): string {
  const channel = (hex: string, index: number) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const out = [0, 1, 2]
    .map((index) => Math.round(channel(color, index) * amount + channel(base, index) * (1 - amount)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `#${out}`;
}

export function Composer({
  target,
  layout = target.kind === "thread" ? "overlay" : "inline",
}: {
  target: ComposerTarget;
  /**
   * `overlay` pins the composer to the bottom of the chat canvas; `inline` centers it
   * with the lane padding; `lane` fills a parent that is already a ChatLane.
   */
  layout?: "overlay" | "inline" | "lane";
}) {
  const lane = <ComposerLane target={target} />;
  const lanePadding = chatLanePadding(useSmallViewport());
  if (layout === "lane") return <div style={{ display: "flex", flexDirection: "row", width: "100%" }}>{lane}</div>;
  return layout === "overlay" ? (
    <ComposerOverlay>{lane}</ComposerOverlay>
  ) : (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        width: "100%",
        paddingLeft: lanePadding,
        paddingRight: lanePadding,
      }}
    >
      {lane}
    </div>
  );
}

/**
 * Pins the composer to the bottom of the chat canvas, in the same column the
 * timeline uses so both clear the inline details card.
 */
function ComposerOverlay({ children }: { children: ReactNode }) {
  const cardInline = useDetailsCardInline();
  const small = useSmallViewport();
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        // web `pt-1.5 sm:pt-2`, and the spacer under the stack `h-4 sm:h-5`.
        paddingTop: small ? 6 : 8,
        paddingBottom: small ? 16 : 20,
        pointerEvents: "none",
      }}
      onLayout={(event) => {
        const size = event as { height?: number };
        // The timeline pads its end by the overlay's height so the last row clears it.
        if (typeof size.height === "number" && Math.abs(appAtomRegistry.get(composerInsetAtom) - size.height) > 0.5) {
          appAtomRegistry.set(composerInsetAtom, size.height);
        }
      }}
    >
      <ChatLane cardInline={cardInline}>
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", width: "100%" }}>{children}</div>
      </ChatLane>
    </div>
  );
}

function ComposerLane({ target }: { target: ComposerTarget }) {
  const environmentId = target.environmentId;
  if (environmentId === null || (target.kind === "draft" && target.projectId === null)) {
    return <ComposerShellPlaceholder text="Choose a project above to start a thread" />;
  }
  return (
    <ComposerBody
      key={composerTargetKey(target)}
      target={target}
      environmentId={environmentId}
      threadId={target.kind === "thread" ? target.threadId : null}
      draftProjectId={target.kind === "draft" ? target.projectId : null}
    />
  );
}

/** A disabled composer for drafts without a project (web: projectSelectionRequired, opacity 75%). */
function ComposerShellPlaceholder({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: LAYOUT.chatMaxWidth, pointerEvents: "auto", opacity: 0.75 }}>
      <div style={{ ...surfaceStyle(theme), paddingTop: 16, paddingLeft: 16, paddingRight: 16, paddingBottom: 60 }}>
        <Text color={alpha(theme.mutedForeground, 0.75)} style={{ lineHeight: PROMPT_LINE_HEIGHT }}>
          {text}
        </Text>
      </div>
    </div>
  );
}

function surfaceStyle(theme: ReturnType<typeof useTheme>) {
  // --chat-composer-glass-surface at --glass-opacity (80%); a theme swaps in its surfaceRaised.
  const glass = mix(theme.composer.surface.slice(0, 7), theme.background.slice(0, 7), 0.8);
  return {
    display: "flex" as const,
    flexDirection: "column" as const,
    width: "100%" as const,
    borderRadius: RADIUS["3xl"],
    borderWidth: 1,
    borderColor: theme.composer.outline,
    backgroundColor: glass,
    // web --shadow-composer: 0 12px 28px -18px. GPUI's blurRadius spreads about
    // twice as far as a CSS blur, so 14 here matches web's 28 pixel for pixel.
    ...(theme.appearance === "dark"
      ? {}
      : { boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 14, spreadRadius: -18, color: "#00000066" } }),
  };
}

/** web `dark:inset-shadow-2xs` (--chat-composer-highlight) under the top outline; GPUI's inset shadow paints over the border. */
function SurfaceHighlight() {
  const theme = useTheme();
  if (theme.composer.highlight === null) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 12,
        right: 12,
        height: 1,
        backgroundColor: theme.composer.highlight,
        pointerEvents: "none",
      }}
    />
  );
}

function ComposerBody({
  target,
  environmentId,
  threadId,
  draftProjectId,
}: {
  target: ComposerTarget;
  environmentId: EnvironmentId;
  threadId: ThreadId | null;
  draftProjectId: ProjectId | null;
}) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const draftKey = composerTargetKey(target);
  const draft = useAtomValue(composerDraftAtom(draftKey));
  const restoredPrompt = useAtomValue(restoredPromptAtom);
  useEffect(() => {
    // "Edit from here" in the timeline hands the reverted prompt back to this thread's composer.
    if (restoredPrompt === null || threadId === null || restoredPrompt.threadId !== threadId) return;
    appAtomRegistry.set(restoredPromptAtom, null);
    restoreComposerContent(draftKey, { prompt: restoredPrompt.prompt, attachments: [] });
    focusComposer();
  }, [restoredPrompt, threadId, draftKey]);
  const newThreadContext = useAtomValue(newThreadContextRequestAtom);
  useEffect(() => {
    // "New thread on <branch>" from the sidebar seeds this project's draft with that workspace.
    if (
      newThreadContext === null ||
      draftProjectId === null ||
      newThreadContext.projectId !== draftProjectId ||
      newThreadContext.environmentId !== environmentId
    ) {
      return;
    }
    appAtomRegistry.set(newThreadContextRequestAtom, null);
    setDraftWorkspace(draftKey, {
      envMode: newThreadContext.envMode,
      branch: newThreadContext.branch,
      worktreePath: newThreadContext.worktreePath,
    });
  }, [newThreadContext, draftProjectId, environmentId, draftKey]);
  // Editing a queued message repurposes the editor: its text lives in a per-run draft and
  // submit saves it in place (web useQueuedRunEdit). Model and mode stay the thread's.
  const queuedEdit = useQueuedRunEdit({ environmentId, threadId });
  const promptKey = queuedEdit.isEditing ? queuedEdit.draftKey ?? draftKey : draftKey;
  const promptDraft = useAtomValue(composerDraftAtom(promptKey));
  const sticky = useAtomValue(stickyModelAtom);
  const settings = useAtomValue(composerSettingsAtom(environmentId));
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const projects = useAtomValue(projectIndexAtom);
  // Drafts have no thread yet; an empty thread id fails the ref schema, so read constants.
  const shell = useAtomValue(
    threadId ? environmentThreadShells.threadShellAtom({ environmentId, threadId }) : NO_THREAD_SHELL_ATOM,
  );
  const threadState = useAtomValue(
    threadId ? environmentThreads.stateAtom(environmentId, threadId) : NO_THREAD_STATE_ATOM,
  );
  const projection = Option.getOrNull(Option.flatMap(AsyncResult.value(threadState), (state) => state.data));
  const projectId = threadId ? (shell?.projectId ?? null) : draftProjectId;
  const project = projectId ? (projects.get(`${environmentId}:${projectId}`) ?? null) : null;
  // Keeps the prepared connection mounted: attachment uploads read its base URL at send time.
  useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId));
  const sending = useAtomValue(composerSendingAtom(draftKey));
  const sendError = useAtomValue(composerSendErrorAtom(draftKey));
  const [modelPickerOpen, setModelPickerOpen] = [
    useAtomValue(modelPickerOpenAtom),
    (open: boolean) => appAtomRegistry.set(modelPickerOpenAtom, open),
  ] as const;
  const menuOpen = useAtomValue(composerMenuOpenAtom);
  const setMenuOpen = (menu: typeof menuOpen) => appAtomRegistry.set(composerMenuOpenAtom, menu);
  const restingRequested = useAtomValue(composerRestingAtom(draftKey));

  // ── Thread runtime ────────────────────────────────────────────────────
  const runtime = projection ? deriveThreadStructureRuntime(projection) : null;
  const phase = threadId ? derivePhase(runtime) : "ready";
  const isRunning = phase === "running";
  const canInterrupt = threadId !== null && (isRunning || threadRuntimeHasInterruptibleRun(runtime));
  const reportedModelSelection = projection ? deriveReportedModelSelection(projection) : null;
  const environmentUnavailable = serverConfig === null;
  const providerStatuses: ReadonlyArray<ServerProvider> = serverConfig?.providers ?? [];
  const keybindings = serverConfig?.keybindings;
  const cwd = shell?.worktreePath ?? project?.workspaceRoot ?? null;

  // ── Provider + model ──────────────────────────────────────────────────
  const prompt = promptDraft.prompt;
  const lockedProvider = deriveLockedProvider({
    thread: shell
      ? { latestRun: shell.latestRun, itemCount: shell.itemCount, runtime: shell.runtime }
      : null,
    selectedProvider: draft.activeProvider,
    threadProvider: shell?.modelSelection.instanceId ?? null,
    providers: providerStatuses,
  });
  // web ChatView: a thread whose provider session can hand off to another
  // provider leaves the model picker unlocked.
  const supportsProviderSwitchingViaHandoff = threadSupportsProviderHandoff(projection);
  const modelPickerLockedProvider = supportsProviderSwitchingViaHandoff ? null : lockedProvider;
  const draftThreadModelSelection: ModelSelection | null =
    (sticky.activeProvider ? (sticky.modelSelectionByProvider[sticky.activeProvider] ?? null) : null) ??
    settings.defaultModelSelection ??
    null;
  const threadModelSelection = threadId ? (shell?.modelSelection ?? null) : draftThreadModelSelection;
  const projectModelSelection = project?.defaultModelSelection ?? null;
  const provider = resolveComposerProviderModel({
    providerStatuses,
    settings,
    activeProjectId: projectId,
    draft,
    threadModelSelection,
    projectModelSelection,
    promptInjectionState: getComposerPromptInjectionState(prompt),
    candidateInstanceIds: [
      draft.activeProvider,
      shell?.runtime?.providerInstanceId,
      threadModelSelection?.instanceId,
      projectModelSelection?.instanceId,
    ],
    // web ChatView hands ChatComposer `modelPickerLockedProvider`: a thread that can hand
    // off its context resolves the composer across every provider, not just its own.
    lockedProvider: modelPickerLockedProvider,
    lockedInstanceId: shell?.runtime?.providerInstanceId ?? shell?.modelSelection.instanceId,
  });
  const {
    providerInstanceEntries,
    selectedProviderEntry,
    lockedContinuationGroupKey,
    selectedInstanceId,
    selectedProvider,
    selectedProviderModels,
    composerModelOptions,
    selectedModel,
    composerProviderState,
  } = provider;
  const noProviderAvailable = selectedProviderEntry === undefined;
  const providerCatalogPending = noProviderAvailable && serverConfig === null;
  const showProviderUnavailable = noProviderAvailable && !providerCatalogPending;
  const selectedProviderStatus = selectedProviderEntry?.snapshot ?? null;
  const modelOptionsByInstance = useMemo(() => {
    const map = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
    for (const entry of providerInstanceEntries) {
      map.set(
        entry.instanceId,
        getAppModelOptionsForInstance(settings, entry, entry.instanceId === selectedInstanceId ? selectedModel : null),
      );
    }
    return map;
  }, [providerInstanceEntries, settings, selectedInstanceId, selectedModel]);
  const selectedModelOptions = composerModelOptions?.[selectedInstanceId];
  const selectedModelSelection = createModelSelection(
    selectedInstanceId,
    selectedModel,
    composerProviderState.modelOptionsForDispatch,
  );
  const traitsModelOptions = withImplicitFastModeDefault(
    getProviderModelCapabilities(selectedProviderModels, selectedModel, selectedProvider, settings.planModeEnabled),
    selectedModelOptions,
  );

  // ── Modes ─────────────────────────────────────────────────────────────
  const requestedRuntimeMode: RuntimeMode =
    draft.runtimeMode ?? shell?.runtimeMode ?? settings.defaultRuntimeMode ?? "full-access";
  const requestedInteractionMode: ProviderInteractionMode =
    draft.interactionMode ?? shell?.interactionMode ?? "default";
  const { enabled: planModeUiEnabled, interactionMode } = resolveComposerInteractionMode({
    planModeEnabled: settings.planModeEnabled,
    provider: selectedProviderStatus,
    interactionMode: requestedInteractionMode,
  });
  const supportedRuntimeModes = selectedProviderStatus?.supportedRuntimeModes;
  const compatibleRuntimeModeOptions =
    supportedRuntimeModes && supportedRuntimeModes.length > 0
      ? ALL_RUNTIME_MODE_OPTIONS.filter((option) => supportedRuntimeModes.includes(option.mode))
      : ALL_RUNTIME_MODE_OPTIONS;
  const runtimeMode = compatibleRuntimeModeOptions.some((option) => option.mode === requestedRuntimeMode)
    ? requestedRuntimeMode
    : (compatibleRuntimeModeOptions[0]?.mode ?? requestedRuntimeMode);

  // ── Pending requests and plan follow-up ──────────────────────────────
  const requests = usePendingThreadRequests({ environmentId, threadId });
  const activePendingProgress = requests.activePendingProgress;
  const isComposerApprovalState = requests.activePendingApproval !== null;
  const latestProposedPlan = projection ? findLatestProposedPlan(projection, shell?.latestRun?.runId ?? null) : null;
  const showPlanFollowUpPrompt =
    threadId !== null &&
    planModeUiEnabled &&
    shouldShowPlanFollowUpPrompt({
      pendingUserInputCount: requests.pendingUserInputs.length,
      interactionMode,
      latestTurnSettled: !isRunning && phase !== "connecting",
      hasActionableProposedPlan: hasActionableProposedPlan(latestProposedPlan),
      hasComposerAttachments: draft.attachments.length > 0,
    });
  const resumableRunId = (() => {
    if (!projection) return null;
    const run = projection.runs.findLast(
      (candidate) => candidate.status !== "queued" && candidate.status !== "preparing",
    );
    return run?.status === "interrupted" ? run.id : null;
  })();
  const hasHeldQueuedRuns = projection?.runs.some((run) => run.status === "queued" && run.queueHeld === true) === true;
  const canResume = resumableRunId !== null || hasHeldQueuedRuns;

  // ── Editor value ──────────────────────────────────────────────────────
  const editorValue = activePendingProgress ? activePendingProgress.customAnswer : prompt;
  const isChoiceOnlyPendingQuestion = activePendingProgress?.activeQuestion?.allowCustomAnswer === false;
  // web isLiteralPendingAnswer: an answer seeded from the question keeps every character as text.
  const isLiteralPendingAnswer = activePendingProgress?.activeQuestion?.initialAnswer !== undefined;
  const caretRef = useRef(editorValue.length);
  const valueRef = useRef(editorValue);
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const [trigger, setTriggerState] = useState<ComposerTrigger | null>(null);
  const dismissedTriggerRef = useRef<ComposerTrigger | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [highlightedSearchKey, setHighlightedSearchKey] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // Below `sm` an unfocused thread composer collapses to one prompt row (web
  // isComposerCollapsedMobile); a press on it expands it until the editor blurs.
  const small = useSmallViewport();
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [mobileFocusPending, setMobileFocusPending] = useState(false);
  const [surfaceWidth, setSurfaceWidth] = useState<number | null>(null);
  const { width: windowWidth } = useWindowSize();
  const [dragOver, setDragOver] = useState(false);
  const mentionDragOver = useAtomValue(mentionDragOverAtom) === draftKey;
  useEffect(() => () => reportComposerDropZone(draftKey, null), [draftKey]);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  useEffect(() => {
    if (valueRef.current !== editorValue) {
      valueRef.current = editorValue;
      caretRef.current = editorValue.length;
    }
  }, [editorValue]);

  const resolveTrigger = (candidate: ComposerTrigger | null) => {
    const dismissed = dismissedTriggerRef.current;
    return candidate && dismissed && candidate.kind === dismissed.kind && candidate.rangeStart === dismissed.rangeStart
      ? null
      : candidate;
  };
  const setTrigger = (candidate: ComposerTrigger | null) => {
    const active = resolveTrigger(candidate);
    if (candidate === null || active !== null) dismissedTriggerRef.current = null;
    setTriggerState(active);
  };
  const dismissTrigger = () => {
    dismissedTriggerRef.current = trigger;
    setTriggerState(null);
  };

  const focusEditor = () => {
    editorRef.current?.focus();
  };
  const focusRequest = useAtomValue(composerFocusRequestAtom);
  const lastFocusRequestRef = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === lastFocusRequestRef.current) return;
    lastFocusRequestRef.current = focusRequest;
    focusEditor();
  });
  // web: opening a thread or draft puts the caret in its composer (the editor mounts
  // focused), so a click on a sidebar row is followed by typing into the prompt. Only when
  // nothing live holds focus: the focused element of the composer this one replaced is gone.
  useEffect(() => {
    if (small) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      timer = null;
      if (!hasEditableFocus(renderer, editorRef.current?.id ?? null) && !isConfirmDialogActive()) {
        if (editorRef.current?.id != null) {
          editorRef.current.focusAtEnd();
          return;
        }
      } else {
        return;
      }
      if (++tries < 10) timer = setTimeout(attempt, 16);
    };
    attempt();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
    // Once per mount: the body is keyed by its target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Command menu ──────────────────────────────────────────────────────
  const selectedProviderSkills = selectedProviderStatus
    ? resolveProviderSkillsForCwd(selectedProviderStatus, cwd)
    : NO_SKILLS;
  const selectedProviderSlashCommands = selectedProviderStatus
    ? resolveProviderSlashCommandsForCwd(selectedProviderStatus, cwd)
    : NO_SLASH_COMMANDS;
  const compactSlashCommandAvailable =
    trigger?.kind === "slash-command" &&
    prompt.slice(0, trigger.rangeStart).trim() === "" &&
    prompt.slice(trigger.rangeEnd).trim() === "" &&
    draft.attachments.length === 0 &&
    threadId !== null &&
    threadShellHasStarted(shell);
  const menu = useComposerMenuItems({
    composerTrigger: activePendingProgress && isChoiceOnlyPendingQuestion ? null : trigger,
    environmentId,
    gitCwd: cwd,
    activeThreadId: threadId,
    planModeUiEnabled,
    compactSlashCommandAvailable,
    selectedProvider,
    selectedProviderSkills,
    selectedProviderSlashCommands,
    showSkillsInSlashMenu: settings.showSkillsInSlashMenu,
  });
  const menuIsOpen = trigger !== null;
  const menuSearchKey = trigger ? `${draftKey}:${trigger.kind}:${trigger.query.trim().toLowerCase()}` : null;
  const activeMenuItemId = resolveComposerMenuActiveItemId({
    items: menu.items as never,
    highlightedItemId,
    currentSearchKey: menuSearchKey,
    highlightedSearchKey,
  });
  const activeMenuItem = menu.items.find((item) => item.id === activeMenuItemId) ?? null;

  // ── Stash ─────────────────────────────────────────────────────────────
  const stash = useComposerStash({
    draftKey,
    prompt,
    commandMenuOpen: menuIsOpen,
    onPromptRestored: () => focusEditor(),
  });

  // ── Editing ───────────────────────────────────────────────────────────
  const writeEditorValue = (next: string) => {
    if (activePendingProgress?.activeQuestion) {
      requests.onChangeActivePendingUserInputCustomAnswer(activePendingProgress.activeQuestion.id, next);
    } else {
      setComposerPrompt(promptKey, next);
    }
  };

  /** web onPromptChange: the editor reports every edit and caret move (a Markdown offset). */
  const onEditorChange = (nextValue: string, caret: number, suppressTrigger: boolean) => {
    const valueChanged = nextValue !== valueRef.current;
    valueRef.current = nextValue;
    caretRef.current = caret;
    if (valueChanged) setSubmissionError(null);
    if (isChoiceOnlyPendingQuestion) return;
    if (valueChanged && !activePendingProgress && promptHistoryPositionRef.current?.position.recalled !== nextValue) {
      promptHistoryPositionRef.current = null;
    }
    if (valueChanged) {
      writeEditorValue(nextValue);
      if (restingRequested) appAtomRegistry.set(composerRestingAtom(draftKey), false);
    }
    setTrigger(isLiteralPendingAnswer || suppressTrigger ? null : detectComposerTrigger(nextValue, caret));
  };

  // ── Prompt history (web useComposerCommandKey navigatePromptHistory) ──
  // Keyed by draft: a recall made in one thread is not a browsing position in another.
  const promptHistoryPositionRef = useRef<{ targetKey: string; position: ComposerPromptHistoryPosition } | null>(null);
  const navigatePromptHistory = (direction: "backward" | "forward", event: KeyEvent): boolean => {
    const mods = event.modifiers ?? { shift: false, ctrl: false, alt: false, cmd: false };
    if (mods.shift || mods.alt || mods.cmd || mods.ctrl) return false;
    if (threadId === null || requests.pendingUserInputs.length > 0 || queuedEdit.isEditing) return false;
    const current = readComposerDraft(promptKey);
    if (
      current.attachments.length > 0 ||
      referencedTerminalContexts(current).length > 0 ||
      referencedReviewComments(current).length > 0
    ) {
      return false;
    }
    const recalled = promptHistoryPositionRef.current;
    const position = recalled?.targetKey === promptKey ? recalled.position : null;
    if (position === null && current.prompt.length > 0) return false;
    if (!editorRef.current?.isCaretOnVisualEdge(direction === "backward" ? "start" : "end")) return false;
    // Built on the keypress, not per render: the timeline changes on every streamed delta.
    const visibleTurnItems = appAtomRegistry.get(
      environmentThreadDetails.visibleTurnItemsAtom(scopeThreadRef(environmentId, threadId)),
    );
    const messages = deriveTimelineEntriesFromVisibleTurnItems({ visibleTurnItems, optimisticMessages: [] }).flatMap(
      (entry) => (entry.kind === "message" ? [entry.message] : []),
    );
    const step = stepComposerPromptHistory({
      direction,
      entries: buildComposerPromptHistoryEntries(messages as never),
      position,
      currentPrompt: current.prompt,
    });
    if (!step) return false;
    promptHistoryPositionRef.current = step.position ? { targetKey: promptKey, position: step.position } : null;
    valueRef.current = step.prompt;
    caretRef.current = step.prompt.length;
    setComposerPrompt(promptKey, step.prompt);
    setTriggerState(null);
    setHighlightedItemId(null);
    return true;
  };

  const applyPromptReplacement = (rangeStart: number, rangeEnd: number, replacement: string) => {
    const current = valueRef.current;
    const next = replaceTextRange(current, rangeStart, rangeEnd, replacement);
    valueRef.current = next.text;
    caretRef.current = next.cursor;
    writeEditorValue(next.text);
    setTrigger(detectComposerTrigger(next.text, next.cursor));
    setHighlightedItemId(null);
    focusEditor();
  };

  const handleInteractionModeChange = (mode: ProviderInteractionMode) => {
    if (mode === "plan" && !planModeUiEnabled) return;
    setComposerInteractionMode(draftKey, mode);
  };
  const toggleInteractionMode = () => {
    if (!planModeUiEnabled) return;
    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan");
  };

  const onSelectMenuItem = (item: ComposerCommandItem) => {
    const current = valueRef.current;
    const active = trigger ?? detectComposerTrigger(current, caretRef.current);
    if (!active) return;
    if (item.type === "path") {
      // web serializes mentions as markdown file links; tiptap shows them as chips, the
      // plain textarea shows the link text.
      const replacement = `${serializeComposerFileLink(item.path)} `;
      const end = extendReplacementRangeForTrailingSpace(current, active.rangeEnd, replacement);
      applyPromptReplacement(active.rangeStart, end, replacement);
      return;
    }
    if (item.type === "slash-command") {
      applyPromptReplacement(active.rangeStart, active.rangeEnd, "");
      if (item.command === "model") {
        setTriggerState(null);
        setModelPickerOpen(true);
        return;
      }
      handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
      return;
    }
    if (item.type === "provider-slash-command") {
      // web ChatComposer onSelectComposerItem: choosing /usage-limits opens the panel
      // right away (only when nothing but the prompt is staged, like web's gate).
      if (item.command.name === USAGE_LIMITS_COMMAND.name && banners.usageLimitsOffered && draft.attachments.length === 0) {
        applyPromptReplacement(active.rangeStart, active.rangeEnd, "");
        setTriggerState(null);
        setHighlightedItemId(null);
        banners.openUsageLimits();
        return;
      }
      const replacement = `/${item.command.name} `;
      const end = extendReplacementRangeForTrailingSpace(current, active.rangeEnd, replacement);
      applyPromptReplacement(active.rangeStart, end, replacement);
      return;
    }
    if (item.type === "thread") {
      // web: an @ match for a thread becomes its chip, with its record kept for the send.
      if (active.kind !== "path") return;
      const shell = appAtomRegistry.get(environmentThreadShells.threadShellAtom(item.thread)) as { title?: string } | null;
      const record = threadContextRecord(item.thread, shell?.title?.trim() || item.label);
      const replacement = `${formatInlineContextReference(threadContextReference(record))} `;
      const end = extendReplacementRangeForTrailingSpace(current, active.rangeEnd, replacement);
      applyPromptReplacement(active.rangeStart, end, replacement);
      addComposerThreadContext(promptKey, record, { appendReference: false });
      return;
    }
    if (item.type === "skill") {
      const replacement = `$${item.skill.name} `;
      const end = extendReplacementRangeForTrailingSpace(current, active.rangeEnd, replacement);
      applyPromptReplacement(active.rangeStart, end, replacement);
      return;
    }
  };

  const nudgeMenuHighlight = (direction: 1 | -1) => {
    if (menu.items.length === 0) return;
    const index = menu.items.findIndex((item) => item.id === activeMenuItemId);
    const normalized = index >= 0 ? index : direction > 0 ? -1 : 0;
    const next = menu.items[(normalized + direction + menu.items.length) % menu.items.length];
    setHighlightedItemId(next?.id ?? null);
    setHighlightedSearchKey(menuSearchKey);
  };

  // ── Tasks and sync activity (web ChatView ~1018-1042, 496) ────────────
  const activeActivityRun = projection ? deriveThreadActivityRun(projection) : null;
  const activeActivityRunSettled = isLatestRunSettled(activeActivityRun, runtime);
  const composerTasksPlan = selectComposerTasksPlan(
    projection,
    deriveActivePlanState(projection, activeActivityRun?.runId),
    activeActivityRun?.runId ?? null,
    activeActivityRunSettled,
  );
  const composerTasks = devComposerTasks(threadId, (() => {
    if (!composerTasksPlan || composerTasksPlan.steps.length === 0) return null;
    const steps = composerTasksPlan.steps;
    return {
      progress: {
        step:
          steps.find((candidate) => candidate.status === "inProgress")?.step ??
          steps.find((candidate) => candidate.status === "pending")?.step ??
          steps.at(-1)!.step,
        completedSteps: steps.filter((step) => step.status === "completed").length,
        totalSteps: steps.length,
        live: !activeActivityRunSettled && composerTasksPlan.runId === activeActivityRun?.runId,
      },
      steps,
    };
  })());
  const threadStatus = useAtomValue(
    threadId ? environmentThreadDetails.statusAtom({ environmentId, threadId }) : NO_THREAD_STATUS_ATOM,
  );
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: projection !== null,
    shellExists: shell !== null,
    status: threadStatus,
  });
  const shownSyncPhase = useDelayedStatus(draftKey, environmentUnavailable ? null : threadSyncPhase);

  // ── Notices ───────────────────────────────────────────────────────────
  // The banner lane above the timeline shows this provider's status (web ChatBannerLane).
  const publishedProviderStatus = useMemo(
    () => (showProviderUnavailable ? null : withDevProviderStatus(selectedProviderStatus)),
    [showProviderUnavailable, selectedProviderStatus],
  );
  useEffect(() => {
    const atom = composerProviderStatusAtom(draftKey);
    if (appAtomRegistry.get(atom) !== publishedProviderStatus) appAtomRegistry.set(atom, publishedProviderStatus);
  }, [draftKey, publishedProviderStatus]);
  const projectClone = useProjectCloneBanner(projectId ? { environmentId, projectId } : null);
  const banners = useComposerBannerItems({
    projectCloneBannerItem: projectClone.projectCloneBannerItem,
    environmentId,
    threadId,
    draftKey,
    shell,
    projection,
    runtime,
    projectCwd: project?.workspaceRoot ?? null,
    isWorking: isRunning || sending,
    activePendingRequestId:
      requests.activePendingApproval?.requestId ?? requests.activePendingUserInput?.requestId ?? null,
    composerHasDraftContent: prompt.trim().length > 0 || draft.attachments.length > 0,
    providerInstanceId: noProviderAvailable ? null : selectedInstanceId,
    providerDriver: selectedProviderStatus?.driver ?? null,
    providers: providerStatuses,
    usageLimitSources: serverConfig?.usageLimitSources,
    getSendContext: () => ({
      providerAvailable: !noProviderAvailable,
      modelSelection: selectedModelSelection,
      runtimeMode,
      interactionMode,
    }),
  });
  const bannerItems = banners.items;

  // ── Send ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!DEV_TERMINAL_CONTEXT || threadId === null) return;
    if ((readComposerDraft(draftKey).terminalContexts?.length ?? 0) > 0) return;
    addTerminalContextToThreadComposer(environmentId, threadId, DEV_TERMINAL_CONTEXT);
  }, [environmentId, threadId, draftKey]);
  // Terminal selections whose reference is still in the prompt (web composerDraft.terminalContexts).
  const composerTerminalContexts = promptDraft.terminalContexts ?? NO_TERMINAL_CONTEXTS;
  const referencedComposerTerminalContexts = useMemo(
    () => referencedTerminalContexts(promptDraft, prompt),
    [promptDraft, prompt],
  );
  const composerSendState = deriveComposerSendState({
    prompt,
    imageCount: draft.attachments.length,
    terminalContexts: referencedComposerTerminalContexts,
    elementContextCount: referencedReviewComments(draft, prompt).length,
  });
  const providerSendBlockReason = getAntigravitySendBlockReason(selectedProviderStatus, selectedModel);
  // ── Multiple models (web useMultipleModelSend; drafts only) ──────────
  const fanoutSelections = useAtomValue(draftFanoutSelectionsAtom(draftKey));
  const multipleModelSelections = target.kind === "draft" ? fanoutSelections : null;
  const supportsMultipleModels = serverConfig?.environment.capabilities.requiredWorktreeBootstrap === true;
  const draftGitStatus = useEnvironmentQuery(
    target.kind === "draft" && project ? vcsEnvironment.status({ environmentId, input: { cwd: project.workspaceRoot } }) : null,
  );
  const draftIsGitRepo = (draftGitStatus.data as { isRepo?: boolean } | null)?.isRepo ?? true;
  const setMultipleModelSelections = (selections: ReadonlyArray<ModelSelection> | null) =>
    appAtomRegistry.set(draftFanoutSelectionsAtom(draftKey), selections);
  // web ComposerModelPicker.toggleModel: two or more models switch to a multiple-model send.
  const toggleModel = (instanceId: ProviderInstanceId, model: string) => {
    const current = multipleModelSelections ?? [selectedModelSelection];
    const matchesModel = (selection: ModelSelection) => {
      if (selection.instanceId !== instanceId) return false;
      const entry = providerInstanceEntries.find((candidate) => candidate.instanceId === selection.instanceId);
      const resolvedModel = resolveModelPickerSelectedModel({
        driverKind: entry?.driverKind,
        model: selection.model,
        options: modelOptionsByInstance.get(selection.instanceId) ?? [],
      });
      return (resolvedModel?.slug ?? selection.model) === model;
    };
    const exists = current.some(matchesModel);
    const next = exists ? current.filter((selection) => !matchesModel(selection)) : [...current, createModelSelection(instanceId, model)];
    if (next.length > 1) {
      setMultipleModelSelections(next);
    } else {
      setMultipleModelSelections(null);
      const remaining = next[0] ?? selectedModelSelection;
      onProviderModelSelect(remaining.instanceId, remaining.model);
    }
  };
  const sendDisabledReason =
    (multipleModelSelections?.length === 0 ? "Select at least one model." : null) ??
    (banners.feedbackUploading ? "Sending feedback" : projectClone.projectCloneSendBlockReason) ??
    (multipleModelSelections === null ? providerSendBlockReason : null);
  const followUpBehavior: "queue" | "steer" =
    requests.pendingApprovals.length > 0 ? "steer" : settings.followUpBehavior;
  const isCompacting = false;

  const submit = (dispatchMode?: ComposerDispatchMode, submissionIntent: ComposerSubmissionIntent = "foreground") => {
    // web useComposerSend: /usage-limits is answered locally from the Limits snapshot.
    if (
      banners.usageLimitsOffered &&
      draft.attachments.length === 0 &&
      !queuedEdit.isEditing &&
      isUsageLimitsCommand(readComposerDraft(promptKey).prompt)
    ) {
      if (banners.openUsageLimits()) {
        valueRef.current = "";
        caretRef.current = 0;
        setComposerPrompt(promptKey, "");
      }
      return;
    }
    if (activePendingProgress) {
      requests.onAdvanceActivePendingUserInput();
      return;
    }
    if (sending || noProviderAvailable || sendDisabledReason !== null || environmentUnavailable) return;
    const promptAtSend = readComposerDraft(promptKey).prompt;
    if (queuedEdit.isEditing) {
      void queuedEdit.saveEdit(promptAtSend);
      return;
    }
    const attachments = readComposerDraft(draftKey).attachments;
    const trimmed = promptAtSend.trim();
    // Plan follow-up: blank implements the plan, text refines it (web submitPlanFollowUp).
    if (showPlanFollowUpPrompt && latestProposedPlan && attachments.length === 0 && threadId) {
      const followUp = resolvePlanFollowUpSubmission({ draftText: promptAtSend, planMarkdown: latestProposedPlan.planMarkdown });
      // web useProposedPlanSend: the composer follows the follow-up's mode, so implementing
      // a plan leaves it on Build for the turns after.
      setComposerInteractionMode(draftKey, followUp.interactionMode);
      void dispatchSend({
        prompt: promptAtSend,
        text: followUp.text,
        attachments: [],
        interactionMode: followUp.interactionMode,
        dispatchMode: "auto",
        ...(followUp.interactionMode === "default"
          ? { sourceProposedPlan: { threadId, planId: latestProposedPlan.id } }
          : {}),
      });
      return;
    }
    const standalone = planModeUiEnabled && attachments.length === 0 ? parseStandaloneComposerSlashCommand(trimmed) : null;
    if (standalone) {
      handleInteractionModeChange(standalone);
      setComposerPrompt(promptKey, "");
      return;
    }
    if (!composerSendState.hasSendableContent && attachments.length === 0) return;
    // web useComposerSend: /feedback in a Codex thread uploads the session to OpenAI.
    const feedbackCommand =
      selectedProvider === "codex" && attachments.length === 0 && !queuedEdit.isEditing ? parseCodexFeedbackCommand(trimmed) : null;
    if (feedbackCommand && multipleModelSelections === null) {
      void submitFeedbackCommand(trimmed, feedbackCommand);
      return;
    }
    const validation = getComposerSubmissionValidationMessage({
      prompt: promptAtSend,
      submissionTarget: "provider-turn",
    });
    if (validation) {
      setSubmissionError(validation);
      return;
    }
    if (multipleModelSelections !== null && project) {
      void submitMultipleModels(promptAtSend, attachments);
      return;
    }
    void dispatchSend({
      prompt: promptAtSend,
      text: promptAtSend.trim(),
      attachments,
      interactionMode,
      background: submissionIntent === "background",
      dispatchMode:
        dispatchMode ??
        resolveComposerDispatchMode({
          running: isRunning,
          alternateModifier: false,
          activeTurnDefault: followUpBehavior,
          canSteer: !isCompacting,
        }),
    });
  };

  const submitMultipleModels = async (promptAtSend: string, attachments: ReadonlyArray<ComposerAttachmentDraft>) => {
    if (!project || multipleModelSelections === null) return;
    const block = multipleModelSendBlock({
      selectionCount: multipleModelSelections.length,
      serverSupportsWorktreeBootstrap: supportsMultipleModels,
      isLocalDraftThread: target.kind === "draft",
      isGitRepo: draftIsGitRepo,
      branch: draft.branch ?? null,
    });
    if (block === "server-outdated") {
      appAtomRegistry.set(composerSendErrorAtom(draftKey), "Update this server before starting multiple models.");
      return;
    }
    if (block === "needs-new-git-thread") {
      toast({
        type: "warning",
        title: "Choose models and a base branch",
        description: "Multiple models need a new thread in a Git project. Each gets its own worktree.",
      });
      return;
    }
    const targets: MultipleModelTarget[] = [];
    for (const resolved of resolveMultipleModelTargets({
      selections: multipleModelSelections,
      providerInstanceEntries,
      messageText: promptAtSend.trim(),
      planModeEnabled: settings.planModeEnabled,
      interactionMode,
    })) {
      if ("error" in resolved) {
        appAtomRegistry.set(composerSendErrorAtom(draftKey), resolved.error);
        return;
      }
      targets.push(resolved);
    }
    setTriggerState(null);
    valueRef.current = "";
    caretRef.current = 0;
    await sendToMultipleModels({
      environmentId,
      draftKey,
      projectId: project.id,
      projectCwd: project.workspaceRoot,
      branch: draft.branch!,
      startFromOrigin: draft.startFromOrigin ?? false,
      prompt: promptAtSend,
      attachments,
      selections: multipleModelSelections,
      targets,
      runtimeMode,
    });
  };

  const submitFeedbackCommand = async (command: string, feedback: { readonly reason?: string }) => {
    const threadKey = banners.routeThreadKey;
    if (!threadId || !projection?.thread.activeProviderThreadId) {
      toast({ type: "warning", title: "Start a Codex thread first", description: "Send a message before you submit feedback." });
      return;
    }
    if (feedbackUploadsInFlight.has(threadKey)) return;
    feedbackUploadsInFlight.add(threadKey);
    await submitCodexFeedback({
      submission: { id: MessageId.make(globalThis.crypto.randomUUID()), command, createdAt: new Date().toISOString() },
      clearDraft: () => {
        valueRef.current = "";
        caretRef.current = 0;
        setComposerPrompt(promptKey, "");
      },
      onUpdate: (submission) => upsertFeedbackSubmission(threadKey, submission),
      upload: () =>
        runAtomCommand(
          appAtomRegistry,
          threadEnvironment.uploadFeedback,
          { environmentId, input: { threadId, ...feedback } } as never,
          { reportFailure: false },
        ) as never,
    }).finally(() => feedbackUploadsInFlight.delete(threadKey));
  };

  const dispatchSend = async (input: {
    prompt: string;
    text: string;
    attachments: ReadonlyArray<ComposerAttachmentDraft>;
    interactionMode: ProviderInteractionMode;
    dispatchMode: ComposerDispatchMode;
    sourceProposedPlan?: { threadId: ThreadId; planId: string };
    background?: boolean;
  }) => {
    if (!project && !threadId) {
      toast({ type: "warning", title: "Choose a project first" });
      return;
    }
    // Terminal excerpts and threads go out as their inline chips' references in the text plus
    // context records, as on web; a record whose chip was deleted stays behind.
    const draftAtSend = readComposerDraft(promptKey);
    const sendTerminalContexts = filterTerminalContextsWithText(referencedTerminalContexts(draftAtSend, input.prompt));
    const sendThreadContexts = referencedThreadContexts(draftAtSend, input.prompt);
    const messageText = input.text;
    const outgoingText = formatOutgoingPrompt({
      provider: selectedProvider,
      model: selectedModel,
      models: selectedProviderModels,
      effort: composerProviderState.promptEffort,
      text: messageText || "[User attached one or more files without additional text. Respond using the conversation context and the attached files.]",
    });
    const sendTarget: ComposerSendTarget = threadId
      ? {
          kind: "thread",
          threadId,
          currentRuntimeMode: shell?.runtimeMode ?? runtimeMode,
          currentInteractionMode: shell?.interactionMode ?? input.interactionMode,
        }
      : {
          kind: "draft",
          projectId: project!.id,
          projectCwd: project!.workspaceRoot,
          envMode: draft.envMode ?? "local",
          branch: draft.branch ?? null,
          worktreePath: draft.worktreePath ?? null,
          startFromOrigin: draft.startFromOrigin ?? false,
        };
    setTriggerState(null);
    const approvalsToDecline = requests.pendingApprovals.filter(
      (approval) => !requests.respondingRequestIds.includes(approval.requestId),
    );
    const sent = await sendComposerMessage({
      environmentId,
      draftKey,
      target: sendTarget,
      prompt: input.prompt,
      outgoingText,
      attachments: input.attachments,
      reviewComments: referencedReviewComments(readComposerDraft(draftKey), input.prompt),
      terminalContexts: sendTerminalContexts,
      threadContexts: sendThreadContexts,
      modelSelection: selectedModelSelection,
      runtimeMode,
      interactionMode: input.interactionMode,
      dispatchMode: input.dispatchMode,
      approvalsToDecline,
      respondToApproval: async (requestId, decision) =>
        (await requests.onRespondToApproval(requestId, decision)) as never,
      ...(input.sourceProposedPlan ? { sourceProposedPlan: input.sourceProposedPlan } : {}),
      ...(input.background ? { background: { projectId } } : {}),
      running: isRunning,
    });
    if (sent) {
      valueRef.current = "";
      caretRef.current = 0;
      if (target.kind === "draft") {
        // The new thread opens with its own composer; leave this draft's workspace choices.
      }
    }
  };

  const onImplementPlanInNewThread = () => {
    if (!latestProposedPlan || !project) return;
    // web useProposedPlanSend.implementInNewThread: a fresh thread whose first turn implements the plan.
    void sendComposerMessage({
      environmentId,
      draftKey: `${draftKey}:implement`,
      target: {
        kind: "draft",
        projectId: project.id,
        projectCwd: project.workspaceRoot,
        envMode: "local",
        branch: shell?.branch ?? null,
        worktreePath: shell?.worktreePath ?? null,
        startFromOrigin: false,
      },
      prompt: "",
      outgoingText: resolvePlanFollowUpSubmission({ draftText: "", planMarkdown: latestProposedPlan.planMarkdown }).text,
      attachments: [],
      modelSelection: selectedModelSelection,
      runtimeMode,
      interactionMode: "default",
      dispatchMode: "auto",
      ...(threadId ? { sourceProposedPlan: { threadId, planId: latestProposedPlan.id } } : {}),
    });
  };

  const onResume = () => {
    if (!threadId || sending) return;
    if (resumableRunId === null) {
      void runAtomCommand(appAtomRegistry, threadEnvironment.resumeThreadQueue, {
        environmentId,
        input: { threadId } as never,
      });
      return;
    }
    void runAtomCommand(appAtomRegistry, threadEnvironment.startTurn, {
      environmentId,
      input: {
        threadId,
        manualContinuationOfRunId: resumableRunId,
        modelSelection: selectedModelSelection,
        message: {
          messageId: globalThis.crypto.randomUUID(),
          role: "user",
          text: "Continue where you left off.",
          attachments: [],
        },
        runtimeMode,
        interactionMode,
        dispatchMode: "start",
      } as never,
    });
  };

  const onInterrupt = () => {
    if (threadId) void interruptComposerTurn(environmentId, threadId);
  };

  // ── Model / traits / mode changes ─────────────────────────────────────
  const getModelDisabledReason = makeModelDisabledReason(
    shell
      ? {
          providers: providerStatuses,
          hasStartedSession: runtime !== null,
          supportsProviderSwitchingViaHandoff,
          currentModelSelection: shell.modelSelection,
          currentProviderInstanceId: runtime?.providerInstanceId ?? null,
        }
      : null,
  );
  // web useComposerSelection.onProviderModelSelect.
  const onProviderModelSelect = (instanceId: ProviderInstanceId, model: string) => {
    setModelPickerOpen(false);
    const entry = providerStatuses.find((snapshot) => snapshot.instanceId === instanceId);
    if (!supportsProviderSwitchingViaHandoff && lockedProvider !== null && entry && entry.driver !== lockedProvider) {
      focusEditor();
      return;
    }
    if (!supportsProviderSwitchingViaHandoff && lockedProvider !== null && runtime?.providerInstanceId) {
      const currentEntry = providerStatuses.find((snapshot) => snapshot.instanceId === runtime.providerInstanceId);
      if (
        currentEntry?.continuation?.groupKey &&
        entry?.continuation?.groupKey &&
        currentEntry.continuation.groupKey !== entry.continuation.groupKey
      ) {
        focusEditor();
        return;
      }
    }
    const resolved = resolveAppModelSelectionForInstance(instanceId, settings, providerStatuses, model);
    if (!resolved) {
      focusEditor();
      return;
    }
    const remembered = sticky.modelSelectionByProvider[instanceId];
    const nextModelSelection: ModelSelection =
      remembered && remembered.model === resolved && remembered.options
        ? { instanceId, model: resolved, options: remembered.options }
        : { instanceId, model: resolved };
    if (shell) {
      const blockReason = getStartedThreadModelChangeBlockReason({
        providers: providerStatuses,
        hasStartedSession: runtime !== null,
        supportsProviderSwitchingViaHandoff,
        currentModelSelection: shell.modelSelection,
        currentProviderInstanceId: runtime?.providerInstanceId ?? null,
        nextModelSelection,
      });
      if (blockReason) {
        toast({ type: "warning", title: blockReason.title, description: blockReason.description });
        focusEditor();
        return;
      }
    }
    setComposerModelSelection(draftKey, nextModelSelection, { explicit: true, replaceOptions: true });
    focusEditor();
  };

  const onPromptEdit = (edit: (current: string) => string) => {
    const current = readComposerDraft(promptKey).prompt;
    const next = edit(current);
    if (next === current) return;
    valueRef.current = next;
    caretRef.current = next.length;
    setComposerPrompt(promptKey, next);
  };

  // mod+shift+E steps the reasoning effort (web ChatComposerHandle.stepReasoningEffort).
  const effortStep = useAtomValue(composerEffortStepAtom);
  const lastEffortNonceRef = useRef(effortStep?.nonce ?? 0);
  useEffect(() => {
    if (!effortStep || effortStep.nonce === lastEffortNonceRef.current) return;
    lastEffortNonceRef.current = effortStep.nonce;
    if (noProviderAvailable || activePendingProgress) return;
    const change = getComposerReasoningStep({
      provider: selectedProvider,
      instanceId: selectedInstanceId,
      model: selectedModel,
      models: selectedProviderModels,
      modelOptions: selectedModelOptions,
      reportedModelSelection,
      prompt,
      cursor: caretRef.current,
      planModeEnabled: settings.planModeEnabled,
      direction: effortStep.direction,
    });
    if (!change) return;
    if (change.modelOptions) setComposerModelOptions(draftKey, selectedInstanceId, selectedModel, change.modelOptions);
    if (change.prompt !== prompt) onPromptEdit(() => change.prompt);
  });

  // ── Attachments ───────────────────────────────────────────────────────
  const fileStagingAllowed = !activePendingProgress;
  const addPaths = (paths: ReadonlyArray<string>) => {
    const { attachments, folders } = attachmentsFromPaths(paths);
    if (attachments.length > 0) addComposerAttachments(draftKey, attachments);
    if (folders.length > 0) {
      const mentions = folders.map((folder) => serializeComposerFileLink(folder)).join(" ");
      const current = valueRef.current;
      const spacer = current.length > 0 && !/\s$/.test(current) ? " " : "";
      applyPromptReplacement(current.length, current.length, `${spacer}${mentions} `);
    }
    focusEditor();
  };
  // web foldPastedText: a paste of 32 KB or more, or one that would push the prompt past
  // the input limit, goes in as a pasted-text.txt attachment instead of prompt text.
  const onPasteText = (text: string): boolean => {
    if (isLiteralPendingAnswer || activePendingProgress) return false;
    const current = readComposerDraft(promptKey);
    const snapshot = editorRef.current?.readSnapshot();
    const wouldExceedInputLimit = wouldTextPasteExceedLimit({
      valueLength: current.prompt.length,
      selection: snapshot ? { start: snapshot.selectionStart, end: snapshot.selectionEnd } : { start: 0, end: 0 },
      textLength: text.length,
      maxLength: PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
    });
    if (pastedTextDisposition({ text, canAttach: true, wouldExceedInputLimit }) !== "attachment") return false;
    const canStage =
      fileStagingAllowed &&
      !queuedEdit.isEditing &&
      serverConfig?.environment.capabilities.fileAttachments !== undefined &&
      current.attachments.length < PROVIDER_SEND_TURN_MAX_ATTACHMENTS;
    if (!canStage) {
      if (!wouldExceedInputLimit) return false;
      toast({ type: "error", title: "Pasted text is too large for this message", description: "Remove some text or an attachment, then paste again." });
      return true;
    }
    const name = nextPastedTextFileName(current.attachments.map((attachment) => attachment.name));
    const { attachments } = attachmentsFromPaths([writePastedTextFile(name, text)]);
    addComposerAttachments(draftKey, attachments.map((attachment) => ({ ...attachment, mimeType: "text/plain" })));
    return true;
  };
  // web onComposerPaste with clipboardData.files: a copied file or a picture attaches.
  const onPasteNonText = () => {
    if (!fileStagingAllowed || queuedEdit.isEditing) return;
    void readClipboardAttachmentPaths().then((paths) => {
      if (paths.length > 0) addPaths(paths);
    });
  };
  const onAttach = async () => {
    const paths = await renderer.promptForPaths?.({ files: true, multiple: true, prompt: "Attach" });
    if (paths && paths.length > 0) addPaths(paths);
  };
  const images = draft.attachments.filter((attachment) => attachment.type === "image");
  const files = draft.attachments.filter((attachment) => attachment.type === "file");

  // ── Context window ────────────────────────────────────────────────────
  const activeProviderThread = projection?.providerThreads.find(
    (candidate) => candidate.id === projection.thread.activeProviderThreadId,
  );
  const liveTokenUsage = projection
    ? latestProviderTurnTokenUsage(projection.providerTurns ?? [], projection, activeProviderThread)
    : null;
  const activeContextWindow = projection
    ? deriveLatestContextWindowSnapshot(
        projection.turnItems.map((item) => ({ item })),
        liveTokenUsage,
        activeProviderThread,
      )
    : null;

  // ── Resting ───────────────────────────────────────────────────────────
  const hasExpandedChrome =
    isComposerApprovalState ||
    requests.pendingUserInputs.length > 0 ||
    showPlanFollowUpPrompt ||
    menuIsOpen ||
    dragOver ||
    showProviderUnavailable ||
    environmentUnavailable ||
    submissionError !== null ||
    menuOpen !== null ||
    stash.menuOpen ||
    modelPickerOpen;
  const isResting =
    threadId !== null &&
    // shouldUseRestingComposerLayout: never on a mobile viewport.
    !small &&
    settings.composerCollapseOnScroll &&
    restingRequested &&
    !focused &&
    !prompt.includes("\n") &&
    !hasExpandedChrome;
  // web isComposerCollapsedMobile. Drafts keep the full composer (forceExpandedOnMobile).
  // An open menu keeps it expanded: web keeps focus inside the composer while one is up.
  const isCollapsedMobile =
    small &&
    threadId !== null &&
    !focused &&
    !mobileExpanded &&
    !prompt.includes("\n") &&
    requests.pendingUserInputs.length === 0 &&
    menuOpen === null &&
    !modelPickerOpen &&
    !stash.menuOpen &&
    !menuIsOpen;
  // web composerControlsCollapsed: the resting strip's xs controls.
  const controlsCollapsed = isResting || isCollapsedMobile;
  const expandMobileComposer = () => {
    setMobileExpanded(true);
    setMobileFocusPending(true);
  };
  useEffect(() => {
    if (!mobileFocusPending || isCollapsedMobile) return;
    setMobileFocusPending(false);
    focusEditor();
  });

  // ── Keyboard (web useComposerCommandKey) ──────────────────────────────
  /** Keys the composer takes before the editor; true when handled. */
  const onEditorKeyCommand = (event: KeyEvent, _context: ComposerEditorKeyContext): boolean => {
    const key = event.key;
    const mods = event.modifiers ?? { shift: false, ctrl: false, alt: false, cmd: false };
    const ctrl = Boolean(mods.ctrl || mods.cmd);
    // A key here proves editor focus even when focus moved without onFocus (focusElement).
    if (!appAtomRegistry.get(composerFocusAtom)) appAtomRegistry.set(composerFocusAtom, true);
    const plainEnter = key === "enter" && !ctrl && !mods.alt && !mods.shift;
    if (stash.menuOpen && !menuIsOpen) {
      if (key === "escape") {
        stash.close();
        return true;
      }
      if (plainEnter) {
        stash.restoreHighlighted();
        return true;
      }
      if ((key === "tab" && !mods.shift) || key === "down" || (ctrl && (key === "n" || key === "j"))) {
        stash.nudge(1);
        return true;
      }
      if ((key === "tab" && mods.shift) || key === "up" || (ctrl && (key === "p" || key === "k"))) {
        stash.nudge(-1);
        return true;
      }
    }
    if (menuIsOpen) {
      if (key === "escape") {
        dismissTrigger();
        return true;
      }
      const item = activeMenuItem ?? menu.items[0];
      if ((plainEnter || (key === "tab" && !mods.shift && !ctrl)) && item) {
        onSelectMenuItem(item);
        return true;
      }
      if (((key === "tab" && mods.shift) || (ctrl && (key === "p" || key === "k")) || (key === "up" && !mods.shift && !ctrl && !mods.alt)) && menu.items.length > 0) {
        nudgeMenuHighlight(-1);
        return true;
      }
      if (((ctrl && (key === "n" || key === "j")) || (key === "down" && !mods.shift && !ctrl && !mods.alt)) && menu.items.length > 0) {
        nudgeMenuHighlight(1);
        return true;
      }
    }
    if (key === "tab" && mods.shift && !ctrl && !mods.alt) {
      toggleInteractionMode();
      return true;
    }
    if (key === "up" || key === "down") {
      return navigatePromptHistory(key === "up" ? "backward" : "forward", event);
    }
    if (plainEnter) {
      if (event.isHeld) return true;
      submit();
      return true;
    }
    // web composerSubmissionIntentForKey. A chord bound to another command (mod+shift+enter
    // steers the queue) is left to the window dispatcher.
    if (key === "enter" && (ctrl || mods.alt)) {
      const command = resolveKeyEventCommand(event, {
        composerFocus: true,
        draftThreadRoute: target.kind === "draft",
        turnRunning: isRunning,
      });
      const submissionIntent: ComposerSubmissionIntent | null =
        command === "composer.sendAlternate" && isRunning
          ? "alternate"
          : command === "composer.sendBackground" && target.kind === "draft"
            ? "background"
            : command === "composer.sendAndNewThread" && target.kind === "thread"
              ? "background"
              : command === null && !mods.shift && !mods.alt
                ? "foreground"
                : null;
      if (submissionIntent === null) return false;
      if (event.isHeld) return true;
      submit(
        resolveComposerDispatchMode({
          running: isRunning,
          alternateModifier: submissionIntent === "alternate",
          activeTurnDefault: followUpBehavior,
          canSteer: !isCompacting,
        }),
        submissionIntent,
      );
      return true;
    }
    return false;
  };

  // web setContextInsertionHandler: "Add to chat" from the terminal lands at the caret.
  const insertAtCaretRef = useRef<(text: string) => boolean>(() => false);
  insertAtCaretRef.current = (text) => {
    if (activePendingProgress || isChoiceOnlyPendingQuestion) return false;
    const editor = editorRef.current;
    if (!editor) return false;
    editor.insertText(text, "caret", { ensureLeadingBoundary: true });
    editor.focus();
    return true;
  };
  useEffect(() => registerComposerInsertionHandler(promptKey, (text) => insertAtCaretRef.current(text)), [promptKey]);

  // What the chips need: the records behind context references, and where a file opens.
  const citationCommentRequest = useAtomValue(citationCommentRequestAtom);
  const draftReviewComments = promptDraft.reviewComments;
  const draftThreadContexts = promptDraft.threadContexts;
  const chipEnvironment = useMemo<ComposerChipEnvironment>(
    () => ({
      environmentId,
      cwd,
      openMention: (path: string) => {
        if (threadId) rightPanelActions.openFile(threadKeyOf(environmentId, threadId), path);
      },
      terminalContexts: new Map(composerTerminalContexts.map((context) => [terminalContextReference(context).contextId, context])),
      reviewComments: new Map((draftReviewComments ?? []).map((comment) => [reviewCommentContextId(comment.id), comment])),
      threadContexts: new Map((draftThreadContexts ?? []).map((record) => [record.contextId, record])),
    }),
    [environmentId, cwd, threadId, composerTerminalContexts, draftReviewComments, draftThreadContexts],
  );

  // ── Shortcuts ─────────────────────────────────────────────────────────
  // The window dispatcher (keybindings/useGlobalKeybindings.ts) resolves the chord; the
  // mounted composer claims the commands whose targets it owns, like web's
  // composerShortcutCommands, ChatView's queue commands and useComposerStash.
  const steerInFlightRef = useRef(false);
  const toggleMenu = (next: NonNullable<typeof menuOpen>) => {
    appAtomRegistry.set(composerRestingAtom(draftKey), false);
    setMenuOpen(appAtomRegistry.get(composerMenuOpenAtom) === next ? null : next);
  };
  const traitsVisible =
    !showProviderUnavailable &&
    shouldRenderTraitsControls({
      provider: selectedProvider,
      models: selectedProviderModels,
      model: selectedModel,
      modelOptions: traitsModelOptions,
      promptUltrathink: readPromptUltrathink(prompt),
      planModeEnabled: settings.planModeEnabled,
    });
  // ── Footer collapse (web composerFooterLayout + useRestingComposerControlsLayout) ──
  const controlBlockIds = traitsVisible ? CONTROL_BLOCKS_WITH_TRAITS : CONTROL_BLOCKS_WITHOUT_TRAITS;
  // The expanded footer and the resting strip each keep their own layout, as web's two hooks do.
  const expandedControls = useComposerControlsLayout({
    blockIds: controlBlockIds,
    pickerMarginInline: -10,
    pickerMinWidth: MODEL_PICKER_TRIGGER_MIN_WIDTH,
    gap: 4,
  });
  // web hides the strip's picker label below a 640px composer surface (a container query).
  const restingPickerLabelCollapsed = surfaceWidth !== null && surfaceWidth <= RESTING_PICKER_LABEL_MAX_SURFACE_PX;
  const restingControls = useComposerControlsLayout({
    blockIds: controlBlockIds,
    pickerMarginInline: 0,
    pickerMinWidth: MODEL_PICKER_TRIGGER_MIN_WIDTH,
    pickerLabelCollapsed: restingPickerLabelCollapsed,
    gap: 4,
  });
  const shortcutCommands: Partial<Record<KeybindingCommand, (event: KeyEvent) => boolean>> = {
    "composer.effort": (event) => {
      if (!event.isHeld && traitsVisible) toggleMenu("traits");
      return true;
    },
    "composer.mode": (event) => {
      if (!event.isHeld && !showProviderUnavailable) toggleMenu("mode");
      return true;
    },
    "composer.workspace": (event) => {
      if (target.kind !== "draft") return false;
      if (!event.isHeld) toggleMenu("env-mode");
      return true;
    },
    "composer.branch": (event) => {
      if (target.kind !== "draft") return false;
      if (!event.isHeld) toggleMenu("branch");
      return true;
    },
    "composer.increaseEffort": (event) => {
      if (!event.isHeld) stepComposerEffort(1);
      return true;
    },
    "composer.decreaseEffort": (event) => {
      if (!event.isHeld) stepComposerEffort(-1);
      return true;
    },
    // Always claimed, like web, even when this state cannot stash.
    "composer.stash": (event) => {
      if (event.isHeld) return true;
      if (requests.pendingUserInputs.length > 0) {
        stash.toggleMenu();
        return true;
      }
      if (activePendingProgress || queuedEdit.isEditing) return true;
      stash.stashCurrent();
      return true;
    },
    // web QueuedRunsControl.editLatest: the newest queued message, only from the start of
    // the editor and not while another queued message is being edited.
    "thread.editQueuedMessage": (event) => {
      if (threadId === null || !projection || queuedEdit.isEditing || caretRef.current !== 0) return false;
      const latest = deriveThreadQueueWorkflowState(projection).queuedRuns.at(-1);
      if (!latest) return false;
      if (!event.isHeld) {
        queuedEdit.beginEdit({
          runId: latest.run.id,
          messageId: latest.run.userMessageId,
          text: latest.text,
          attachments: latest.attachments,
        });
      }
      return true;
    },
    // web QueuedRunsControl.steerNext: the first queued message starts now or steers.
    "thread.steerQueuedMessage": (event) => {
      if (threadId === null || !projection) return false;
      const workflow = deriveThreadQueueWorkflowState(projection);
      const next = workflow.queuedRuns[0];
      if (!next || !(workflow.canSendNow || workflow.canPromoteToSteer)) return false;
      if (!event.isHeld && !steerInFlightRef.current) {
        steerInFlightRef.current = true;
        void sendQueuedRunNow({ environmentId, threadId, workflow, queuedRunId: next.run.id }).finally(() => {
          steerInFlightRef.current = false;
        });
      }
      return true;
    },
  };
  // ── Type-to-focus (web composerFocusRedirect + usePasteToFocusComposer) ──
  // A printable key or a paste with nothing editable focused goes to the end of the prompt.
  const appendToEditor = (text: string) => {
    if (isChoiceOnlyPendingQuestion || requests.activePendingIsResponding) return false;
    const editor = editorRef.current;
    if (editor) {
      // Straight into the editor's state: the next key can reach the editor before this
      // composer re-renders it with a new value, and must land after this one.
      if (restingRequested) appAtomRegistry.set(composerRestingAtom(draftKey), false);
      editor.appendTyped(text);
      editor.focus();
      return true;
    }
    const next = `${valueRef.current}${text}`;
    valueRef.current = next;
    caretRef.current = next.length;
    writeEditorValue(next);
    if (restingRequested) appAtomRegistry.set(composerRestingAtom(draftKey), false);
    setTrigger(detectComposerTrigger(next, next.length));
    focusEditor();
    return true;
  };
  const typeToFocus = (event: KeyEvent, eventRenderer: unknown) => {
    if (consumeComposerSinkPasteKeystroke(event)) return true;
    const mods = event.modifiers ?? { shift: false, ctrl: false, alt: false, cmd: false };
    const focusedId = (eventRenderer as { getFocusedElementId?: () => number | null } | undefined)?.getFocusedElementId?.();
    // A burst typed with nothing focused: the first key focused the editor, but GPUI had
    // already dispatched the rest with no focus, so they reach only this window handler.
    // Each goes to the editor, in order, unless the editor received it itself.
    const editor = editorRef.current;
    if (
      editor &&
      focusedId !== null &&
      focusedId !== undefined &&
      focusedId === editor.id &&
      event.keystrokeId !== undefined &&
      !editor.receivedKeystroke(event.keystrokeId)
    ) {
      editor.handleKey(event);
      return true;
    }
    // A focused field or this editor keeps its own keys (web shouldRedirectInputToComposer);
    // a focused row or control, or an element no longer on screen, does not.
    if (hasEditableFocus(eventRenderer, editor?.id ?? null)) return false;
    if (
      appAtomRegistry.get(terminalFocusAtom) ||
      appAtomRegistry.get(modelPickerOpenAtom) ||
      appAtomRegistry.get(composerMenuOpenAtom) !== null ||
      stash.menuOpen ||
      isConfirmDialogActive()
    ) {
      return false;
    }
    const isPaste = (mods.ctrl || mods.cmd) && !mods.alt && !mods.shift && event.key === "v";
    if (isPaste) {
      void readClipboardText().then(
        (text) => {
          if (text.length === 0) onPasteNonText();
          else if (!onPasteText(text.replace(/\r\n?/g, "\n"))) appendToEditor(text);
        },
        () => onPasteNonText(),
      );
      return true;
    }
    if (mods.ctrl || mods.cmd || mods.alt || event.isHeld) return false;
    // Any typed text, including a multi-code-point commit (terminal-mode IME, emoji).
    const char = typedText(event.keyChar);
    if (char === null) return false;
    return appendToEditor(char);
  };
  const typeToFocusRef = useRef(typeToFocus);
  typeToFocusRef.current = typeToFocus;
  useEffect(() => registerTypeToFocusHandler((event, eventRenderer) => typeToFocusRef.current(event, eventRenderer)), []);

  const shortcutCommandsRef = useRef(shortcutCommands);
  shortcutCommandsRef.current = shortcutCommands;
  useEffect(() => {
    const unregister = Object.keys(shortcutCommandsRef.current).map((command) =>
      registerShortcutHandler(command as KeybindingCommand, (resolved, event) =>
        shortcutCommandsRef.current[resolved]?.(event) ?? false,
      ),
    );
    return () => {
      for (const dispose of unregister) dispose();
      appAtomRegistry.set(composerFocusAtom, false);
    };
  }, []);

  const isPathQueryActive = () => trigger?.kind === "path";
  const onEditorFocus = () => {
    setFocused(true);
    appAtomRegistry.set(composerFocusAtom, true);
  };
  const onEditorBlur = () => {
    setFocused(false);
    setMobileExpanded(false);
    appAtomRegistry.set(composerFocusAtom, false);
  };

  // ── Placeholder ───────────────────────────────────────────────────────
  const placeholder = isComposerApprovalState
    ? "Send a message to decline and redirect the agent"
    : activePendingProgress
      ? isChoiceOnlyPendingQuestion
        ? "Choose an option above"
        : "Type your own answer, or leave this blank to use the selected option"
      : showPlanFollowUpPrompt
        ? "Add feedback to refine the plan, or leave this blank to implement it"
        : showProviderUnavailable
          ? "Enable a provider in Settings to send a message"
          : // web: a thread without a runtime yet (never run, or a new draft) is "disconnected".
            environmentUnavailable || derivePhase(runtime) === "disconnected"
            ? DISCONNECTED_COMPOSER_PLACEHOLDER
            : DEFAULT_PLACEHOLDER;

  // ── Render ────────────────────────────────────────────────────────────
  const controlsSize = controlsCollapsed ? "xs" : "sm";
  const pendingAction = activePendingProgress
    ? {
        questionIndex: activePendingProgress.questionIndex,
        isLastQuestion: activePendingProgress.isLastQuestion,
        canAdvance: activePendingProgress.canAdvance,
        isResponding: requests.activePendingIsResponding,
        isComplete: Boolean(requests.activePendingResolvedAnswers),
      }
    : null;
  const activeThreadModelDisplayName = resolveContextWindowModelDisplayName(
    shell?.modelSelection ?? null,
    modelOptionsByInstance,
  );
  const compactCommandAvailable = providerSupportsManualCompaction(selectedProviderEntry);

  const activeControls = controlsCollapsed ? restingControls : expandedControls;
  const hiddenBlockIds = hiddenComposerControlBlockIds(controlBlockIds, activeControls.layout);
  const traitsInOverflow = hiddenBlockIds.includes("traits");
  const modeInOverflow = hiddenBlockIds.includes("mode");
  // web openControl clicks the first visible control bound to the shortcut, which is the ⋯
  // trigger once the traits or mode block has moved into it.
  const overflowOpen =
    menuOpen === "overflow" || (menuOpen === "traits" && traitsInOverflow) || (menuOpen === "mode" && modeInOverflow);
  // web closes a menu whose trigger hides (useComposerMenuState(hidden)).
  useEffect(() => {
    if (menuOpen === "overflow" && hiddenBlockIds.length === 0) setMenuOpen(null);
  });
  const restingControlsVisible = activeControls.layout.visible;
  const onRuntimeModeChange = (mode: RuntimeMode) => {
    setComposerRuntimeMode(draftKey, mode);
    focusEditor();
  };
  const traitsProps = {
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    models: selectedProviderModels,
    model: selectedModel,
    modelOptions: traitsModelOptions,
    reportedModelSelection,
    promptUltrathink: readPromptUltrathink(prompt),
    onPromptEdit,
    onModelOptionsChange: (next: Parameters<typeof setComposerModelOptions>[3]) =>
      setComposerModelOptions(draftKey, selectedInstanceId, selectedModel, next),
    planModeEnabled: settings.planModeEnabled,
  };
  const controlBlocks: ComposerControlBlockDef[] = [
    ...(traitsVisible
      ? [
          {
            id: "traits",
            content: (
              <>
                <ComposerControlSeparator size={controlsSize} />
                <TraitsPicker
                  {...traitsProps}
                  size={controlsSize}
                  open={menuOpen === "traits" && !traitsInOverflow}
                  onOpenChange={(open) => setMenuOpen(open ? "traits" : null)}
                />
              </>
            ),
          },
        ]
      : []),
    {
      id: "mode",
      content: (
        <ComposerFooterModeControls
          showInteractionModeToggle={planModeUiEnabled}
          interactionMode={interactionMode}
          runtimeMode={runtimeMode}
          runtimeModeOptions={compatibleRuntimeModeOptions}
          size={controlsSize}
          modeMenuOpen={menuOpen === "mode" && !modeInOverflow}
          onModeMenuOpenChange={(open) => setMenuOpen(open ? "mode" : null)}
          onToggleInteractionMode={toggleInteractionMode}
          onRuntimeModeChange={onRuntimeModeChange}
        />
      ),
    },
  ];

  const controls = showProviderUnavailable ? (
    <Text color={theme.mutedForeground} weight={500}>
      No provider available
    </Text>
  ) : (
    <ComposerControlsBar
      layout={activeControls.layout}
      measure={activeControls.measure}
      blocks={controlBlocks}
      picker={
        <ProviderModelPicker
          environmentId={environmentId}
          activeInstanceId={selectedInstanceId}
          model={selectedModel}
          lockedProvider={modelPickerLockedProvider}
          lockedContinuationGroupKey={lockedContinuationGroupKey}
          instanceEntries={providerInstanceEntries}
          modelOptionsByInstance={modelOptionsByInstance}
          {...(keybindings ? { keybindings } : {})}
          size={controlsSize}
          disabled={providerCatalogPending || sending}
          open={modelPickerOpen}
          onOpenChange={setModelPickerOpen}
          getModelDisabledReason={getModelDisabledReason}
          onOpenProviderSetup={() => appAtomRegistry.set(routeAtom, { kind: "settings", page: "providers" })}
          onInstanceModelChange={(instanceId, model) => {
            setMultipleModelSelections(null);
            onProviderModelSelect(instanceId, model);
          }}
          {...(target.kind === "draft" && supportsMultipleModels
            ? {
                ...(multipleModelSelections !== null ? { selectedModels: multipleModelSelections } : {}),
                onToggleModel: toggleModel,
              }
            : {})}
          measure={activeControls.measure.picker}
          collapseLabel={controlsCollapsed && restingPickerLabelCollapsed}
        />
      }
      overflowMenu={
        <CompactComposerControlsMenu
          interactionMode={interactionMode}
          runtimeMode={runtimeMode}
          runtimeModeOptions={compatibleRuntimeModeOptions}
          size={controlsSize}
          open={overflowOpen}
          onOpenChange={(open) => setMenuOpen(open ? "overflow" : null)}
          showInteractionModeToggle={planModeUiEnabled && modeInOverflow}
          traitsMenuContent={
            traitsInOverflow ? (
              <TraitsMenuContent {...traitsProps} onClose={() => setMenuOpen(null)} />
            ) : undefined
          }
          onToggleInteractionMode={toggleInteractionMode}
          onRuntimeModeChange={onRuntimeModeChange}
        />
      }
    />
  );

  // web measureFooterCompactness: the composer form's width against 620px (780px while the
  // footer holds the wide plan / pending-answer actions).
  const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
  const isComposerFooterCompact = shouldUseCompactComposerFooter(surfaceWidth, {
    hasWideActions: composerFooterHasWideActions,
  });
  const isComposerPrimaryActionsCompact =
    isComposerFooterCompact &&
    shouldUseCompactComposerPrimaryActions(surfaceWidth, { hasWideActions: composerFooterHasWideActions });
  // web `gap-1.5` compact, else `gap-2 sm:gap-0`.
  const footerGap = isComposerFooterCompact ? 6 : windowWidth >= SM_BREAKPOINT ? 0 : 8;

  const primaryActions = (
    <ComposerPrimaryActions
      compact={isResting || isComposerPrimaryActionsCompact}
      canOperateThread={true}
      pendingAction={pendingAction}
      isRunning={isRunning}
      canInterrupt={canInterrupt}
      followUpBehavior={followUpBehavior}
      canSteer={!isCompacting}
      showPlanFollowUpPrompt={requests.pendingUserInputs.length === 0 && showPlanFollowUpPrompt}
      promptHasText={prompt.trim().length > 0}
      isSendBusy={sending || queuedEdit.isSaving}
      sendDisabledReason={sendDisabledReason}
      isConnecting={phase === "connecting" && !isRunning && sending}
      isEnvironmentUnavailable={environmentUnavailable || noProviderAvailable}
      isPreparingWorktree={sending && target.kind === "draft" && draft.envMode === "worktree"}
      hasSendableContent={composerSendState.hasSendableContent || draft.attachments.length > 0}
      canResume={canResume && prompt.trim().length === 0 && draft.attachments.length === 0}
      alternateModifier={false}
      isEditingQueuedMessage={queuedEdit.isEditing}
      alternateShortcutLabel={
        keybindings
          ? shortcutLabelForCommand(keybindings, "composer.sendAlternate", {
              context: { composerFocus: true, draftThreadRoute: target.kind === "draft", turnRunning: true },
            })
          : null
      }
      onSubmit={(mode) => submit(mode)}
      onResume={onResume}
      onPreviousPendingQuestion={requests.onPreviousActivePendingUserInputQuestion}
      onAdvancePendingQuestion={requests.onAdvanceActivePendingUserInput}
      onInterrupt={onInterrupt}
      onImplementPlanInNewThread={onImplementPlanInNewThread}
    />
  );

  const surfaceBase = surfaceStyle(theme);
  const collapsedResume = canResume && prompt.trim().length === 0 && draft.attachments.length === 0;
  // web ChatView showProviderSubagentBar: a provider-native subagent can't take messages,
  // so the composer gives way to a bar with its model, live status and "Open parent".
  if (shell && isProviderNativeSubagentThread(shell.source)) {
    const subagentModels = selectedProviderEntry?.models ?? [];
    const subagentModelSlug = selectedProviderEntry
      ? resolveSelectableModel(selectedProviderEntry.driverKind, shell.modelSelection.model, subagentModels)
      : null;
    const subagentCatalogModel = subagentModels.find((model) => model.slug === subagentModelSlug);
    const parentThreadId = shell.lineage.parentThreadId;
    return (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: LAYOUT.chatMaxWidth, pointerEvents: "auto" }}>
        <div
          style={surfaceBase}
          onLayout={(event) => {
            const width = (event as { width?: number }).width;
            if (typeof width === "number" && width !== surfaceWidth) setSurfaceWidth(width);
          }}
        >
          <ProviderSubagentBar
            provider={selectedProviderEntry ?? null}
            showInstanceBadge={
              selectedProviderEntry !== undefined && shouldShowInstanceBadge(selectedProviderEntry, providerInstanceEntries)
            }
            modelLabel={
              subagentCatalogModel
                ? getTriggerDisplayModelName(subagentCatalogModel)
                : formatModelSlugName(shell.modelSelection.model)
            }
            effortLabel={formatModelSelectionEffort(shell.modelSelection, subagentModels, reportedModelSelection)}
            status={projection ? deriveProviderSubagentStatus(projection) : null}
            onOpenParent={
              parentThreadId
                ? () => appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId: parentThreadId })
                : null
            }
            width={surfaceWidth}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxWidth: LAYOUT.chatMaxWidth,
        pointerEvents: "auto",
      }}
    >
      <ComposerTopBanners
        trailing={
          <ComposerStashBadge
            count={stash.entries.length}
            menuOpen={stash.menuOpen}
            pulsing={stash.pulsing}
            onToggleMenu={stash.toggleMenu}
          />
        }
        requests={requests}
        bannerItems={bannerItems}
        tasks={composerTasks}
        syncPhase={shownSyncPhase}
        surfaceWidth={surfaceWidth}
        canOperateThread={true}
        showPlanFollowUp={!isCollapsedMobile && showPlanFollowUpPrompt && latestProposedPlan !== null}
        collapsedMobile={isCollapsedMobile}
        planFollowUpTitle={
          showPlanFollowUpPrompt && latestProposedPlan ? (proposedPlanTitle(latestProposedPlan.planMarkdown) ?? null) : null
        }
        attachedAbove={
          threadId ? (
            <QueuedRunsControl
              environmentId={environmentId}
              threadId={threadId}
              canOperateThread={true}
              editingRunId={queuedEdit.editingRunId}
              onEditQueuedRun={queuedEdit.beginEdit}
              onCancelEdit={queuedEdit.cancelEdit}
            />
          ) : null
        }
      />
      <StripBehindSurface
        strip={
          target.kind === "draft" && project ? (
            <BranchToolbar
              environmentId={environmentId}
              projectId={project.id}
              draftKey={draftKey}
              onComposerFocusRequest={focusEditor}
            />
          ) : controlsCollapsed ? (
            <RestingModelStrip measure={restingControls.measure}>{controls}</RestingModelStrip>
          ) : null
        }
        stripHidden={controlsCollapsed && !restingControlsVisible}
      >
      <div
        testId="composer-surface"
        onLayout={(event) => {
          const width = (event as { width?: number }).width;
          if (typeof width === "number" && width !== surfaceWidth) setSurfaceWidth(width);
          // Files tree rows drop mentions here (panels/files/fileTreeActions.ts).
          reportComposerDropZone(draftKey, {
            x: Number(event.x ?? 0),
            y: Number(event.y ?? 0),
            width: Number(event.width ?? 0),
            height: Number(event.height ?? 0),
          });
        }}
        onFileDrop={(event) => {
          setDragOver(false);
          const paths = (event as { paths?: string[] }).paths ?? [];
          if (paths.length > 0 && fileStagingAllowed) addPaths(paths);
        }}
        onMouseDown={() => {
          // The collapsed row expands from its prompt text; its send button must not.
          if (isCollapsedMobile) return;
          if (isResting) {
            appAtomRegistry.set(composerRestingAtom(draftKey), false);
            focusEditor();
          }
        }}
        style={{
          ...surfaceBase,
          position: "relative",
          // web: bg-accent/45 and ring-1 ring-inset ring-primary/70 while a file or thread is dragged over.
          ...(dragOver || mentionDragOver ? { backgroundColor: mix("#ffffff", surfaceBase.backgroundColor, 0.02), borderColor: alpha(theme.primary, 0.7) } : {}),
        }}
      >
        <ThreadContextDragGhost />
        {threadId ? <OptimisticMessageReconciler environmentId={environmentId} threadId={threadId} /> : null}
        <SurfaceHighlight />
        {stash.menuOpen && !menuIsOpen && surfaceWidth !== null ? (
          <ComposerCommandMenuLayer surfaceWidth={surfaceWidth}>
            <ComposerStashMenu
              entries={stash.entries}
              highlightedId={stash.highlightedId}
              stashShortcutLabel={keybindings ? shortcutLabelForCommand(keybindings, "composer.stash") : null}
              onHighlight={stash.setHighlightedId}
              onRestore={stash.restore}
              onDelete={stash.remove}
              onClose={stash.close}
            />
          </ComposerCommandMenuLayer>
        ) : null}
        {menuIsOpen && surfaceWidth !== null ? (
          <ComposerCommandMenuLayer surfaceWidth={surfaceWidth}>
            <ComposerCommandMenu
              items={menu.items}
              isLoading={menu.isLoading}
              triggerKind={trigger?.kind ?? null}
              emptyStateText={menu.emptyState}
              activeItemId={activeMenuItemId}
              onHighlightedItemChange={(itemId) => {
                setHighlightedItemId(itemId);
                setHighlightedSearchKey(menuSearchKey);
              }}
              onSelect={onSelectMenuItem}
            />
          </ComposerCommandMenuLayer>
        ) : null}
        {isCollapsedMobile ? (
          <CollapsedMobilePromptRow
            prompt={prompt}
            placeholder={showProviderUnavailable ? "Enable a provider in Settings" : "Ask anything..."}
            resume={collapsedResume}
            disabled={
              sending ||
              environmentUnavailable ||
              noProviderAvailable ||
              (!collapsedResume && !(composerSendState.hasSendableContent || draft.attachments.length > 0))
            }
            onExpand={expandMobileComposer}
            onPrimary={() => {
              if (collapsedResume) onResume();
              else
                submit(
                  resolveComposerDispatchMode({
                    running: isRunning,
                    alternateModifier: false,
                    activeTurnDefault: followUpBehavior,
                    canSteer: !isCompacting,
                  }),
                );
            }}
          />
        ) : null}
        {isCollapsedMobile ? null : (
        <div
          style={{
            display: "flex",
            flexDirection: isResting ? "row" : "column",
            alignItems: isResting ? "center" : "stretch",
            // web: Main p-px + body pt-4 / pb-2 around a 70px editor (`px-3 pt-3.5` below
            // sm). GPUI sets the 14px glyphs 2px lower in a 23px line than Chrome does in
            // 22.75, so 15/10 lands the same rows.
            paddingTop: isResting ? 8 : small ? 13 : 15,
            paddingBottom: isResting ? 8 : 10,
            paddingLeft: small ? 12 : 16,
            paddingRight: small ? 12 : 16,
            gap: isResting ? 4 : 0,
          }}
        >
          {!isResting ? <ComposerAttachmentMediaRow images={images} onRemove={(id) => removeComposerAttachment(draftKey, id)} /> : null}
          {!isResting ? <ComposerAttachmentFileList files={files} onRemove={(id) => removeComposerAttachment(draftKey, id)} /> : null}
          <div style={{ position: "relative", flexGrow: 1, minWidth: 0 }}>
            <ComposerEditor
              ref={editorRef}
              testId="composer"
              value={editorValue}
              cursor={caretRef.current}
              skills={selectedProviderSkills}
              codeBlocks={settings.composerRichTextEnabled}
              literal={isLiteralPendingAnswer}
              readOnly={isChoiceOnlyPendingQuestion || requests.activePendingIsResponding}
              placeholder={placeholder}
              resting={isResting}
              minRows={isResting ? 1 : 3}
              maxRows={isResting ? 1 : 9}
              chipEnvironment={chipEnvironment}
              citationCommentRequest={citationCommentRequest?.key === promptKey ? citationCommentRequest : null}
              isPathQueryActive={isPathQueryActive}
              onChange={onEditorChange}
              onKeyCommand={onEditorKeyCommand}
              onPasteText={onPasteText}
              onPasteNonText={onPasteNonText}
              onFocus={onEditorFocus}
              onBlur={onEditorBlur}
            />
          </div>
          {isResting ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {fileStagingAllowed ? <ComposerAttachButton onClick={() => void onAttach()} /> : null}
              {primaryActions}
            </div>
          ) : null}
        </div>
        )}
        {submissionError ?? sendError ? (
          <div style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 8 }}>
            <Text size="xs" color={theme.errorForeground}>
              {submissionError ?? sendError}
            </Text>
          </div>
        ) : null}
        {!isResting && !isCollapsedMobile ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: footerGap,
              // px-3 pb-3 sm:px-4 sm:pb-4
              paddingLeft: small ? 12 : 16,
              paddingRight: small ? 12 : 16,
              paddingBottom: small ? 12 : 16,
              paddingTop: requests.pendingUserInputs.length > 0 ? 8 : 0,
            }}
          >
            <ExpandedControlsHost measure={expandedControls.measure}>{controls}</ExpandedControlsHost>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
              {fileStagingAllowed ? <ComposerAttachButton onClick={() => void onAttach()} /> : null}
              {settings.contextWindowMeterEnabled && activeContextWindow ? (
                <ContextWindowMeter
                  usage={activeContextWindow}
                  modelDisplayName={activeThreadModelDisplayName}
                  {...(compactCommandAvailable && threadId
                    ? {
                        onCompact: () =>
                          void dispatchSend({
                            prompt: "",
                            text: "/compact",
                            attachments: [],
                            interactionMode,
                            dispatchMode: "auto",
                          }),
                      }
                    : {})}
                  compactDisabled={isRunning || sending}
                  compactDisabledReason={isRunning ? "Wait for the current turn to finish." : null}
                />
              ) : null}
              {primaryActions}
            </div>
          </div>
        ) : null}
      </div>
      </StripBehindSurface>
    </div>
  );
}

/**
 * web ChatComposer showCollapsedMobilePromptRow: the prompt (or "Ask anything...") as one
 * truncated line and a 32px send button, `px-3 py-2`. A press anywhere else expands it.
 */
function CollapsedMobilePromptRow({
  prompt,
  placeholder,
  resume,
  disabled,
  onExpand,
  onPrimary,
}: {
  prompt: string;
  placeholder: string;
  resume: boolean;
  disabled: boolean;
  onExpand: () => void;
  onPrimary: () => void;
}) {
  const theme = useTheme();
  const text = prompt.trim();
  return (
    <div
      testId="composer-collapsed-mobile"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
      }}
    >
      <div testId="composer-expand" onClick={onExpand} style={{ display: "flex", flexGrow: 1, minWidth: 0, cursor: "text" }}>
        <text
          style={{
            color: text ? theme.foreground : alpha(theme.mutedForeground, 0.75),
            fontSize: 14,
            lineHeight: 20,
            fontFamily: FONTS.sans,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            overflow: "hidden",
            minWidth: 0,
            pointerEvents: "none",
          }}
        >
          {text || placeholder}
        </text>
      </div>
      <div
        testId="composer-collapsed-send"
        onClick={disabled ? undefined : onPrimary}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: 16,
          flexShrink: 0,
          backgroundColor: theme.messageAction,
          opacity: disabled ? 0.64 : 1,
          cursor: disabled ? "default" : "pointer",
          ...(disabled ? {} : { hover: { backgroundColor: alpha(theme.messageAction, 0.9) } }),
        }}
      >
        {resume ? (
          <Icon name="play" size={16} color={theme.primaryForeground} />
        ) : (
          <svg source={COLLAPSED_SEND_SVG} style={{ width: 16, height: 16, color: theme.primaryForeground, pointerEvents: "none" }} />
        )}
      </div>
    </div>
  );
}

const COLLAPSED_SEND_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3L8 13M8 3L4 7M8 3L12 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * web ChatView: an optimistic message leaves once the server's copy is in the thread. Only
 * subscribes to the thread's items while one is pending, so streaming does not re-render
 * the composer.
 */
function OptimisticMessageReconciler({ environmentId, threadId }: { environmentId: EnvironmentId; threadId: ThreadId }) {
  const threadKey = useMemo(() => scopedThreadKey(scopeThreadRef(environmentId, threadId)), [environmentId, threadId]);
  const pending = useAtomValue(optimisticMessagesAtom(threadKey));
  if (pending.length === 0) return null;
  return <OptimisticMessageWatcher environmentId={environmentId} threadId={threadId} threadKey={threadKey} />;
}

function OptimisticMessageWatcher({
  environmentId,
  threadId,
  threadKey,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  threadKey: string;
}) {
  const items = useAtomValue(environmentThreadDetails.visibleTurnItemsAtom(scopeThreadRef(environmentId, threadId)));
  useEffect(() => {
    const committed = new Set<string>();
    for (const { item } of items) if (item.type === "user_message") committed.add(item.messageId);
    if (committed.size > 0) removeOptimisticMessages(threadKey, (message) => committed.has(message.id));
  }, [items, threadKey]);
  return null;
}

/**
 * web ComposerSurface.ContextStrip: a strip under the composer, inset 22px a side, whose top
 * 16px tuck under the surface (`-mt-4`, composer `z-10`). gpuix paints in tree order and has
 * no z-index, so the strip renders first, absolutely at the bottom, and a spacer reserves the
 * part that shows below the surface. Strip components render only their box (no margins).
 */
function StripBehindSurface({
  strip,
  stripHidden,
  children,
}: {
  strip: ReactNode;
  /** web hides the resting model strip (`invisible absolute`) when even the collapsed controls do not fit. */
  stripHidden?: boolean;
  children: ReactNode;
}) {
  const [stripHeight, setStripHeight] = useState(49);
  if (strip === null || strip === false) return <>{children}</>;
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          position: "absolute",
          left: 22,
          right: 22,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          // Opacity, not visibility: gpuix skips hidden elements in prepaint, so a hidden strip
          // would stop reporting its width and could never measure its way back to visible.
          ...(stripHidden ? { opacity: 0, pointerEvents: "none" } : {}),
        }}
        onLayout={(event) => {
          const height = (event as { height?: number }).height;
          if (typeof height === "number" && Math.abs(height - stripHeight) > 0.5) setStripHeight(height);
        }}
      >
        {strip}
      </div>
      {children}
      <div style={{ height: stripHidden ? 0 : Math.max(0, stripHeight - 16), flexShrink: 0, pointerEvents: "none" }} />
    </div>
  );
}

/**
 * web ChatComposer's footer controls row: `flex-1 min-w-0`, with `-m-1 -ms-3.5 p-1 ps-3.5` so the
 * picker's `-ms-2.5` and focus rings are not clipped. Its content box is the space the
 * collapse layout fits the controls into.
 */
function ExpandedControlsHost({ measure, children }: { measure: ComposerControlsMeasurer; children: ReactNode }) {
  return (
    <div
      testId="composer-footer-controls"
      onLayout={(event) => {
        const width = (event as { width?: number }).width;
        if (typeof width === "number") measure.host(width - 14 - 4);
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 0,
        overflow: "hidden",
        marginTop: -4,
        marginBottom: -4,
        marginLeft: -14,
        marginRight: -4,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 14,
        paddingRight: 4,
      }}
    >
      {children}
    </div>
  );
}

/**
 * web ComposerSurface.ContextStrip hosting the resting controls (xs) under a collapsed composer:
 * the host is `min-w-0 flex-1`, the controls `flex w-max min-w-0 max-w-full gap-1`.
 */
function RestingModelStrip({ measure, children }: { measure: ComposerControlsMeasurer; children: ReactNode }) {
  const theme = useTheme();
  return (
    <div
      testId="composer-resting-strip"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        paddingTop: 20,
        paddingLeft: 8,
        paddingRight: 8,
        paddingBottom: 4,
        borderBottomLeftRadius: RADIUS["2xl"],
        borderBottomRightRadius: RADIUS["2xl"],
        borderWidth: 1,
        borderTopWidth: 0,
        borderColor: alpha("#ffffff", 0.07),
        // dark:bg-composer-seam-below over the timeline, measured ≈ white 5% on the background.
        backgroundColor: mix("#ffffff", theme.background, 0.05),
      }}
    >
      <div
        onLayout={(event) => {
          const width = (event as { width?: number }).width;
          if (typeof width === "number") measure.host(width);
        }}
        style={{ display: "flex", flexDirection: "row", flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            minWidth: 0,
            flexShrink: 1,
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
