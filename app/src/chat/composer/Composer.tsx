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
// Keyboard (gpuix textarea limits, docs/gpuix-notes.md): GPUI's editor actions consume
// Enter, Up/Down and Backspace before onKeyDown, so the command menu uses:
//   Enter (textarea onSubmit) or Tab  → select the highlighted item
//   Ctrl+N / Ctrl+J, Ctrl+P / Ctrl+K   → move the highlight down / up (Up/Down never arrive)
//   Shift+Tab                           → move the highlight up while the menu is open,
//                                         otherwise toggle Build/Plan (web parity)
//   Escape                              → dismiss the menu
// Modified Enter follows web composerSubmissionIntentForKey (alternate while running,
// background in a draft, send-and-new in a thread). Other composer chords (effort, mode,
// stash, branch, workspace, queue edit/steer) reach the window dispatcher, and this
// composer claims them with registerShortcutHandler.
// The caret position is not exposed by gpuix, so trigger detection uses the caret implied
// by each edit (the end of the inserted text, or the deletion point).
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
  deriveReportedModelSelection,
  deriveThreadStructureRuntime,
  threadRuntimeHasInterruptibleRun,
} from "@t3tools/client-runtime/state/thread-execution";
import { threadSupportsProviderHandoff } from "@t3tools/client-runtime/state/thread-workflows";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
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
import { derivePhase, findLatestProposedPlan, hasActionableProposedPlan } from "../../web/session-logic.ts";
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
import { ContextWindowMeter } from "./ContextWindowMeter.tsx";
import { MODEL_PICKER_TRIGGER_MIN_WIDTH, ProviderModelPicker } from "./ProviderModelPicker.tsx";
import { QueuedRunsControl } from "./QueuedRunsControl.tsx";
import { registerShortcutHandler, resolveKeyEventCommand } from "../../keybindings/useGlobalKeybindings.ts";
import { composerFocusAtom } from "../../state/keybindings.ts";
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

export type { ComposerTarget } from "../../state/composer.ts";

/** web restingBlockDefs ids, in footer order. */
const CONTROL_BLOCKS_WITH_TRAITS = ["traits", "mode"] as const;
const CONTROL_BLOCKS_WITHOUT_TRAITS = ["mode"] as const;
/** `@max-[640px]/composer-surface`: the resting strip's picker drops its label at or under this. */
const RESTING_PICKER_LABEL_MAX_SURFACE_PX = 640;
/** Tailwind `sm`: web's footer drops its gap from this viewport width up. */
const SM_BREAKPOINT = 640;

const NO_THREAD_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null);
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

/** Where the caret sits after an edit from `previous` to `next`: the end of what changed. */
function caretAfterEdit(previous: string, next: string): number {
  let start = 0;
  const max = Math.min(previous.length, next.length);
  while (start < max && previous[start] === next[start]) start++;
  let end = 0;
  while (
    end < max - start &&
    previous[previous.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end++;
  }
  return next.length - end;
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
  const caretRef = useRef(editorValue.length);
  const valueRef = useRef(editorValue);
  const editorRef = useRef<{ id: number } | null>(null);
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
    if (editorRef.current) renderer.focusElement?.(editorRef.current.id);
  };
  const focusRequest = useAtomValue(composerFocusRequestAtom);
  const lastFocusRequestRef = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === lastFocusRequestRef.current) return;
    lastFocusRequestRef.current = focusRequest;
    focusEditor();
  });

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

  const onEditorChange = (nextValue: string) => {
    const caret = caretAfterEdit(valueRef.current, nextValue);
    valueRef.current = nextValue;
    caretRef.current = caret;
    setSubmissionError(null);
    if (isChoiceOnlyPendingQuestion) return;
    writeEditorValue(nextValue);
    if (restingRequested) appAtomRegistry.set(composerRestingAtom(draftKey), false);
    setTrigger(activePendingProgress?.activeQuestion?.initialAnswer !== undefined ? null : detectComposerTrigger(nextValue, caret));
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
      const replacement = `/${item.command.name} `;
      const end = extendReplacementRangeForTrailingSpace(current, active.rangeEnd, replacement);
      applyPromptReplacement(active.rangeStart, end, replacement);
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

  // ── Send ──────────────────────────────────────────────────────────────
  const composerSendState = deriveComposerSendState({
    prompt,
    imageCount: draft.attachments.length,
    terminalContexts: [],
    elementContextCount: referencedReviewComments(draft, prompt).length,
  });
  const providerSendBlockReason = getAntigravitySendBlockReason(selectedProviderStatus, selectedModel);
  const sendDisabledReason = providerSendBlockReason;
  const followUpBehavior: "queue" | "steer" =
    requests.pendingApprovals.length > 0 ? "steer" : settings.followUpBehavior;
  const isCompacting = false;

  const submit = (dispatchMode?: ComposerDispatchMode, submissionIntent: ComposerSubmissionIntent = "foreground") => {
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
    const validation = getComposerSubmissionValidationMessage({
      prompt: promptAtSend,
      submissionTarget: "provider-turn",
    });
    if (validation) {
      setSubmissionError(validation);
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
    const outgoingText = formatOutgoingPrompt({
      provider: selectedProvider,
      model: selectedModel,
      models: selectedProviderModels,
      effort: composerProviderState.promptEffort,
      text: input.text || "[User attached one or more files without additional text. Respond using the conversation context and the attached files.]",
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
      modelSelection: selectedModelSelection,
      runtimeMode,
      interactionMode: input.interactionMode,
      dispatchMode: input.dispatchMode,
      approvalsToDecline,
      respondToApproval: async (requestId, decision) =>
        (await requests.onRespondToApproval(requestId, decision)) as never,
      ...(input.sourceProposedPlan ? { sourceProposedPlan: input.sourceProposedPlan } : {}),
      ...(input.background ? { background: { projectId } } : {}),
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

  // ── Keyboard ──────────────────────────────────────────────────────────
  const onEditorKeyDown = (event: KeyEvent) => {
    const key = event.key;
    const mods = event.modifiers ?? { shift: false, ctrl: false, alt: false, cmd: false };
    const ctrl = Boolean(mods.ctrl || mods.cmd);
    // A key here proves editor focus even when focus moved without onFocus (focusElement).
    if (!appAtomRegistry.get(composerFocusAtom)) appAtomRegistry.set(composerFocusAtom, true);
    if (stash.menuOpen && !menuIsOpen) {
      if (key === "escape") {
        event.preventDefault();
        event.stopPropagation();
        stash.close();
        return;
      }
      if ((key === "tab" && !mods.shift) || (ctrl && (key === "n" || key === "j"))) {
        event.preventDefault();
        stash.nudge(1);
        return;
      }
      if ((key === "tab" && mods.shift) || (ctrl && (key === "p" || key === "k"))) {
        event.preventDefault();
        stash.nudge(-1);
        return;
      }
    }
    if (menuIsOpen) {
      if (key === "escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissTrigger();
        return;
      }
      if (key === "tab" && !mods.shift) {
        event.preventDefault();
        const item = activeMenuItem ?? menu.items[0];
        if (item) onSelectMenuItem(item);
        return;
      }
      if ((key === "tab" && mods.shift) || (ctrl && (key === "p" || key === "k"))) {
        event.preventDefault();
        nudgeMenuHighlight(-1);
        return;
      }
      if (ctrl && (key === "n" || key === "j")) {
        event.preventDefault();
        nudgeMenuHighlight(1);
        return;
      }
    }
    if (key === "tab" && mods.shift) {
      event.preventDefault();
      toggleInteractionMode();
      return;
    }
    // web composerSubmissionIntentForKey. Plain Enter never reaches here (the textarea's
    // onSubmit takes it); modified Enter does. A chord bound to another command
    // (mod+shift+enter steers the queue) is left to the window dispatcher.
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
      if (submissionIntent === null) return;
      event.preventDefault();
      if (event.isHeld) return;
      submit(
        resolveComposerDispatchMode({
          running: isRunning,
          alternateModifier: submissionIntent === "alternate",
          activeTurnDefault: followUpBehavior,
          canSteer: !isCompacting,
        }),
        submissionIntent,
      );
    }
  };

  const onEditorSubmit = () => {
    if (stash.menuOpen && !menuIsOpen) {
      stash.restoreHighlighted();
      return;
    }
    if (menuIsOpen) {
      const item = activeMenuItem ?? menu.items[0];
      if (item) {
        onSelectMenuItem(item);
        return;
      }
    }
    submit();
  };

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
          onInstanceModelChange={onProviderModelSelect}
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
  const editorTextStyle = {
    fontSize: 14,
    lineHeight: PROMPT_LINE_HEIGHT,
    fontFamily: FONTS.sans,
    color: theme.foreground,
  };

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
        canOperateThread={true}
        showPlanFollowUp={showPlanFollowUpPrompt && latestProposedPlan !== null}
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
          ...(dragOver ? { backgroundColor: mix("#ffffff", surfaceBase.backgroundColor, 0.045), borderColor: alpha(theme.primary, 0.7) } : {}),
        }}
      >
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
            {editorValue.length === 0 ? (
              <text
                style={{
                  ...editorTextStyle,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  color: alpha(theme.mutedForeground, 0.75),
                  whiteSpace: isResting ? "nowrap" : undefined,
                  textOverflow: isResting ? "ellipsis" : undefined,
                  overflow: "hidden",
                  pointerEvents: "none",
                  ...(isResting ? { lineHeight: 32 } : {}),
                }}
              >
                {placeholder}
              </text>
            ) : null}
            <textarea
              ref={editorRef as never}
              testId="composer"
              value={editorValue}
              placeholder=""
              minRows={isResting ? 1 : 3}
              maxRows={isResting ? 1 : 9}
              readOnly={isChoiceOnlyPendingQuestion || requests.activePendingIsResponding}
              theme={{ caret: theme.foreground }}
              style={{ ...editorTextStyle, ...(isResting ? { lineHeight: 32 } : {}) }}
              onChange={(event) => onEditorChange(event.value ?? "")}
              onSubmit={onEditorSubmit}
              onKeyDown={onEditorKeyDown}
              onFocus={() => {
                setFocused(true);
                appAtomRegistry.set(composerFocusAtom, true);
              }}
              onBlur={() => {
                setFocused(false);
                setMobileExpanded(false);
                appAtomRegistry.set(composerFocusAtom, false);
              }}
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
