// apps/web/src/components/chat/ComposerPrimaryActions.tsx: send / stop / queue / steer /
// resume, the Implement / Refine plan pills and the pending-question submit pill.
//   send: 32×32 circle message-action, arrow 14 @1.8, disabled 64%
//   stop: 32×32 circle destructive/90 with an 8×8 rounded square
//   pills: h 32 (28 inside a pending question) px 16, rounded full, 14 medium
import {
  alternateComposerDispatchAction,
  type ComposerDispatchMode,
  resolveComposerDispatchMode,
} from "@t3tools/client-runtime/state/composer-dispatch";
import type { EventPayload } from "@gpuix/react";
import { type ReactNode, useState } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Menu, MenuItem, Tooltip } from "../../ui/overlay.tsx";
import { Button } from "../../ui/primitives.tsx";
import { FONTS, alpha, useTheme } from "../../ui/theme.ts";

export interface PendingActionState {
  readonly questionIndex: number;
  readonly isLastQuestion: boolean;
  readonly canAdvance: boolean;
  readonly isResponding: boolean;
  readonly isComplete: boolean;
}

const ARROW_UP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STOP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';
const PLAY_FILLED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>';

const formatPendingPrimaryActionLabel = (input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}) => {
  if (input.isResponding) return "Submitting...";
  if (input.compact) return input.isLastQuestion ? "Submit" : "Next";
  if (!input.isLastQuestion) return "Next question";
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
};

export function ComposerPrimaryActions(props: {
  compact: boolean;
  canOperateThread: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  canInterrupt: boolean;
  followUpBehavior: "queue" | "steer";
  canSteer: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  canResume: boolean;
  /** Ctrl is held: the alternate dispatch (queue ↔ steer) applies. */
  alternateModifier: boolean;
  /** Keybinding label for `composer.sendAlternate` (Ctrl+Enter by default). */
  alternateShortcutLabel?: string | null;
  onSubmit: (dispatchMode: ComposerDispatchMode) => void;
  onResume: () => void;
  onPreviousPendingQuestion: () => void;
  onAdvancePendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
}) {
  const theme = useTheme();
  const isSendDisabled = !props.canOperateThread || props.sendDisabledReason !== null;
  const dispatchMode = resolveComposerDispatchMode({
    running: props.isRunning,
    activeTurnDefault: props.followUpBehavior,
    canSteer: props.canSteer,
    alternateModifier: props.alternateModifier,
  });
  const isQueuing = dispatchMode === "queue";
  const alternateAction = alternateComposerDispatchAction(props.followUpBehavior);

  const stopButton = (insidePendingAction: boolean) => (
    <Tooltip content="Interrupt" side="top" key="interrupt">
      <CircleButton
        testId="composer-stop"
        size={insidePendingAction ? 28 : 32}
        background={alpha(theme.error, 0.9)}
        hoverBackground={theme.error}
        disabled={!props.canOperateThread}
        onClick={() => {
          if (props.canOperateThread) props.onInterrupt();
        }}
      >
        <svg source={STOP_SVG} style={{ width: 12, height: 12, color: "#ffffff", pointerEvents: "none" }} />
      </CircleButton>
    </Tooltip>
  );

  if (props.pendingAction) {
    const pending = props.pendingAction;
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: props.compact ? 6 : 8 }}>
        {props.canInterrupt ? stopButton(true) : null}
        {pending.questionIndex > 0 ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending.isResponding}
            onClick={props.onPreviousPendingQuestion}
            testId="composer-previous-question"
          >
            Previous
          </Button>
        ) : null}
        <Pill
          testId="composer-submit-answer"
          height={28}
          disabled={
            !props.canOperateThread ||
            props.isEnvironmentUnavailable ||
            pending.isResponding ||
            (pending.isLastQuestion ? !pending.isComplete : !pending.canAdvance)
          }
          onClick={props.onAdvancePendingQuestion}
        >
          {formatPendingPrimaryActionLabel({
            compact: props.compact,
            isLastQuestion: pending.isLastQuestion,
            isResponding: pending.isResponding,
            questionIndex: pending.questionIndex,
          })}
        </Pill>
      </div>
    );
  }

  const busy = props.isSendBusy || props.isConnecting;
  const planDisabled = busy || isSendDisabled || props.isEnvironmentUnavailable;

  if (props.showPlanFollowUpPrompt && (props.promptHasText || !props.canResume)) {
    if (props.promptHasText) {
      return (
        <Pill testId="composer-refine" disabled={planDisabled} onClick={() => props.onSubmit(dispatchMode)}>
          {busy ? "Sending..." : "Refine"}
        </Pill>
      );
    }
    return (
      <ImplementSplitButton
        busy={busy}
        disabled={planDisabled}
        onImplement={() => props.onSubmit(dispatchMode)}
        onImplementInNewThread={() => {
          if (props.canOperateThread) props.onImplementPlanInNewThread();
        }}
      />
    );
  }

  if (props.canInterrupt && !props.hasSendableContent) return stopButton(false);

  const showResume = props.canResume && !props.hasSendableContent;
  const submitLabel = showResume
    ? "Resume thread"
    : isQueuing
      ? "Queue message"
      : props.isRunning
        ? "Steer message"
        : "Submit message";
  const submitStatus = props.isEnvironmentUnavailable
    ? "Environment disconnected"
    : (props.sendDisabledReason ??
      (props.isConnecting
        ? "Connecting"
        : props.isPreparingWorktree
          ? "Preparing worktree"
          : props.isSendBusy
            ? "Submitting message"
            : null));
  const submitTooltip =
    submitStatus ??
    (props.isRunning && props.canSteer
      ? `Click to ${props.followUpBehavior}, Ctrl/⌘-click${props.alternateShortcutLabel ? ` or ${props.alternateShortcutLabel}` : ""} to ${alternateAction}`
      : submitLabel);
  const disabled =
    busy || isSendDisabled || props.isEnvironmentUnavailable || (!props.hasSendableContent && !showResume);
  const runningIcon: IconName = isQueuing ? "list-plus" : "corner-up-right";
  return (
    <Tooltip content={submitTooltip} side="top">
      <CircleButton
        testId="composer-send"
        size={32}
        background={theme.messageAction}
        hoverBackground={alpha(theme.messageAction, 0.9)}
        disabled={disabled}
        onClick={(event) => {
          if (showResume) {
            props.onResume();
            return;
          }
          const ctrl = Boolean(event?.modifiers?.ctrl || event?.modifiers?.cmd);
          props.onSubmit(
            resolveComposerDispatchMode({
              running: props.isRunning,
              activeTurnDefault: props.followUpBehavior,
              canSteer: props.canSteer,
              alternateModifier: ctrl || props.alternateModifier,
            }),
          );
        }}
      >
        {busy ? (
          <Icon name="loader-circle" size={16} color="#ffffff" />
        ) : showResume ? (
          <svg source={PLAY_FILLED_SVG} style={{ width: 16, height: 16, color: "#ffffff", pointerEvents: "none" }} />
        ) : props.isRunning ? (
          <Icon name={runningIcon} size={16} color="#ffffff" />
        ) : (
          <svg source={ARROW_UP_SVG} style={{ width: 14, height: 14, color: "#ffffff", pointerEvents: "none" }} />
        )}
      </CircleButton>
    </Tooltip>
  );
}

function CircleButton({
  children,
  size,
  background,
  hoverBackground,
  disabled,
  onClick,
  testId,
  ...rest
}: {
  children: ReactNode;
  size: number;
  background: string;
  hoverBackground: string;
  disabled?: boolean;
  onClick?: (event?: EventPayload) => void;
  testId?: string;
  [key: string]: unknown;
}) {
  return (
    <div
      {...rest}
      testId={testId}
      onClick={disabled ? undefined : (event: EventPayload) => onClick?.(event)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size / 2,
        flexShrink: 0,
        backgroundColor: background,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: hoverBackground } }),
      }}
    >
      {children}
    </div>
  );
}

function Pill({
  children,
  disabled,
  onClick,
  height = 32,
  testId,
  roundLeft = true,
  roundRight = true,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  height?: number;
  testId?: string;
  roundLeft?: boolean;
  roundRight?: boolean;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height,
        paddingLeft: 16,
        paddingRight: 16,
        flexShrink: 0,
        borderTopLeftRadius: roundLeft ? height / 2 : 0,
        borderBottomLeftRadius: roundLeft ? height / 2 : 0,
        borderTopRightRadius: roundRight ? height / 2 : 0,
        borderBottomRightRadius: roundRight ? height / 2 : 0,
        backgroundColor: theme.messageAction,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: alpha(theme.messageAction, 0.9) } }),
      }}
    >
      <text
        style={{
          color: theme.primaryForeground,
          fontSize: 14,
          lineHeight: 20,
          fontWeight: 500,
          fontFamily: FONTS.sans,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {children}
      </text>
    </div>
  );
}

function ImplementSplitButton(props: {
  busy: boolean;
  disabled: boolean;
  onImplement: () => void;
  onImplementInNewThread: () => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
      <Pill testId="composer-implement" disabled={props.disabled} roundRight={false} onClick={props.onImplement}>
        {props.busy ? "Sending..." : "Implement"}
      </Pill>
      <Menu
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
        minWidth={200}
        trigger={({ toggle }) => (
          <div
            testId="composer-implement-menu"
            onClick={props.disabled ? undefined : toggle}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 32,
              paddingLeft: 8,
              paddingRight: 8,
              borderTopRightRadius: 16,
              borderBottomRightRadius: 16,
              borderLeftWidth: 1,
              borderColor: alpha(theme.primaryForeground, 0.2),
              backgroundColor: theme.messageAction,
              opacity: props.disabled ? 0.64 : 1,
              cursor: props.disabled ? "default" : "pointer",
              ...(props.disabled ? {} : { hover: { backgroundColor: alpha(theme.messageAction, 0.9) } }),
            }}
          >
            <Icon name="chevron-down" size={14} color={theme.primaryForeground} />
          </div>
        )}
      >
        <MenuItem disabled={props.disabled} onSelect={props.onImplementInNewThread}>
          Implement in a new thread
        </MenuItem>
      </Menu>
    </div>
  );
}
