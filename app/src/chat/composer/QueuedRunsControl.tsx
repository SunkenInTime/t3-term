// Port of apps/web/src/components/chat/QueuedRunsControl.tsx: the queued messages
// waiting behind the running turn, docked above the composer. Each row can be
// reordered (drag the grip, or arrow keys on it), edited, sent as a steer (or sent
// now when nothing runs), or removed.
//
// Differences from web: no image thumbnails (attachment URLs need the asset loader;
// image rows show a placeholder square), no optimistic "saving" rows, and editing is
// opt-in through `onEditQueuedRun` because the composer owns the editor retarget.
import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { deriveThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import type { ChatAttachment, EnvironmentId, MessageId, RunId, ThreadId } from "@t3tools/contracts";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { environmentThreads, threadEnvironment } from "../../state/environment.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  BannerActions,
  BannerAttachment,
  BannerContent,
  BannerCount,
  BannerIcon,
  BannerIconButton,
  BannerRoot,
  BannerRow,
  BannerText,
  BannerToggleIcon,
  useRegisterBannerAttachment,
} from "./ComposerBannerParts.tsx";

export interface EditQueuedRunRequest {
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}

/** Rows are at least 24px (their icon-xs buttons) with a 1px gap. */
const FALLBACK_ROW_PITCH = 25;

export function QueuedRunsControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly canOperateThread: boolean;
  /** The run whose message the composer is editing, if any. */
  readonly editingRunId?: RunId | null;
  /** Starts editing a queued message in the composer. Without it the edit button is hidden. */
  readonly onEditQueuedRun?: (request: EditQueuedRunRequest) => void;
  readonly onCancelEdit?: () => void;
}) {
  const theme = useTheme();
  const result = useAtomValue(environmentThreads.stateAtom(props.environmentId, props.threadId));
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;
  const [expanded, setExpanded] = useState(true);
  const [busyRunId, setBusyRunId] = useState<RunId | null>(null);
  const [drag, setDrag] = useState<{
    readonly runId: RunId;
    readonly fromIndex: number;
    readonly startY: number;
    readonly insertIndex: number | null;
  } | null>(null);
  const rowPitchRef = useRef(FALLBACK_ROW_PITCH);
  const steerInFlightRef = useRef(false);

  const workflow = projection ? deriveThreadQueueWorkflowState(projection) : null;
  const queued = workflow?.queuedRuns ?? [];
  const activeRun = workflow?.activeRun ?? null;
  const canReorder = workflow?.canReorder === true && props.canOperateThread;
  const canSend = (workflow?.canSendNow === true || workflow?.canPromoteToSteer === true) && props.canOperateThread;
  const editingRunId = props.editingRunId ?? null;

  useRegisterBannerAttachment(queued.length > 0);

  if (queued.length === 0) return null;

  const scope = { environmentId: props.environmentId };
  const threadId = props.threadId;

  const move = async (runId: RunId, beforeRunId: RunId | null) => {
    setBusyRunId(runId);
    await runAtomCommand(appAtomRegistry, threadEnvironment.reorderQueuedRun, {
      ...scope,
      input: { threadId, runId, beforeRunId },
    });
    setBusyRunId(null);
  };

  const completeDrag = (runId: RunId, insertIndex: number | null) => {
    setDrag(null);
    if (insertIndex === null || busyRunId !== null) return;
    const draggedIndex = queued.findIndex(({ run }) => run.id === runId);
    if (draggedIndex === -1) return;
    if (insertIndex === draggedIndex || insertIndex === draggedIndex + 1) return;
    void move(runId, queued[insertIndex]?.run.id ?? null);
  };

  const sendQueuedMessage = async (queuedRunId: RunId) => {
    if (!canSend || steerInFlightRef.current) return;
    steerInFlightRef.current = true;
    setBusyRunId(queuedRunId);
    if (workflow?.canSendNow) {
      await runAtomCommand(appAtomRegistry, threadEnvironment.resumeThreadQueue, {
        ...scope,
        input: { threadId, runId: queuedRunId },
      });
    } else if (activeRun !== null) {
      await runAtomCommand(appAtomRegistry, threadEnvironment.promoteQueuedRun, {
        ...scope,
        input: { threadId, queuedRunId, targetRunId: activeRun.id },
      });
    }
    steerInFlightRef.current = false;
    setBusyRunId(null);
  };

  const remove = async (runId: RunId) => {
    setBusyRunId(runId);
    await runAtomCommand(appAtomRegistry, threadEnvironment.cancelQueuedRun, {
      ...scope,
      input: { threadId, runId },
    });
    setBusyRunId(null);
  };

  const indicator = (
    <div style={{ height: 2, borderRadius: 1, backgroundColor: alpha(theme.primary, 0.7), flexShrink: 0 }} />
  );

  return (
    <BannerAttachment testId="queued-runs">
      <BannerRoot>
        <BannerRow testId="queued-runs-toggle" onClick={() => setExpanded((value) => !value)}>
          <BannerIcon name="list-ordered" />
          <BannerContent>
            <BannerText color={theme.mutedForeground}>Queued</BannerText>
          </BannerContent>
          <BannerActions>
            <BannerCount>{String(queued.length)}</BannerCount>
            <BannerToggleIcon expanded={expanded} />
          </BannerActions>
        </BannerRow>
        {expanded ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              maxHeight: 128,
              overflowY: "scroll",
              scrollbarWidth: 6,
              scrollbarColor: theme.scrollbar,
            }}
          >
            {queued.map(({ run, text, attachments }, index) => {
              const imageCount = attachments.filter((attachment) => attachment.type === "image").length;
              const previewText = assistantCitationsToPlainText(
                replaceComposerContextReferences(text, (reference) =>
                  reference.kind === "image" && imageCount > 0 ? "" : reference.label,
                ),
              )
                .trim()
                .replace(/\s+/g, " ");
              const isEditing = run.id === editingRunId;
              const isDragged = drag?.runId === run.id;
              const rowDraggable = canReorder && busyRunId === null;
              return (
                <div key={run.id} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                  {drag && drag.insertIndex === index ? indicator : null}
                  <div
                    onLayout={index === 0 ? (event) => (rowPitchRef.current = (event.height ?? 24) + 1) : undefined}
                    // A grip drag must not select row text on the way.
                    style={{ display: "flex", flexDirection: "column", opacity: isDragged ? 0.5 : 1, userSelect: "none" }}
                  >
                    <BannerRow
                      testId={`queued-run-${index}`}
                      style={{
                        minHeight: 20,
                        borderRadius: 4,
                        ...(isEditing ? { backgroundColor: theme.accent } : {}),
                      }}
                    >
                      <BannerIcon>
                        {rowDraggable || (canReorder && drag !== null) ? (
                          <div
                            testId={`queued-run-${index}-grip`}
                            tabIndex={0}
                            onMouseDown={(event) =>
                              setDrag({ runId: run.id, fromIndex: index, startY: event.y ?? 0, insertIndex: null })
                            }
                            onMouseMove={(event) => {
                              if (!drag || drag.runId !== run.id || event.y === undefined) return;
                              const offset = Math.round((event.y - drag.startY) / rowPitchRef.current);
                              const insertIndex =
                                offset === 0
                                  ? null
                                  : offset < 0
                                    ? Math.max(0, drag.fromIndex + offset)
                                    : Math.min(queued.length, drag.fromIndex + offset + 1);
                              if (insertIndex !== drag.insertIndex) setDrag({ ...drag, insertIndex });
                            }}
                            onMouseUp={() => {
                              if (drag && drag.runId === run.id) completeDrag(drag.runId, drag.insertIndex);
                            }}
                            onKeyDown={(event) => {
                              if (busyRunId !== null) return;
                              if (event.key === "up" && index > 0) {
                                event.preventDefault();
                                void move(run.id, queued[index - 1]?.run.id ?? null);
                              }
                              if (event.key === "down" && index < queued.length - 1) {
                                event.preventDefault();
                                void move(run.id, queued[index + 2]?.run.id ?? null);
                              }
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 24,
                              height: 24,
                              borderRadius: RADIUS.md,
                              cursor: "grab",
                              hover: { backgroundColor: theme.accent },
                              active: { cursor: "grabbing" },
                            }}
                          >
                            <Icon name="grip-vertical" size={14} color={theme.mutedForeground} />
                          </div>
                        ) : null}
                      </BannerIcon>
                      <BannerContent>
                        {imageCount > 0 ? (
                          <div style={{ display: "flex", flexDirection: "row", gap: 2, flexShrink: 0 }}>
                            {Array.from({ length: imageCount }, (_, imageIndex) => (
                              <div
                                key={imageIndex}
                                style={{
                                  width: 16,
                                  height: 16,
                                  borderRadius: 4,
                                  borderWidth: 1,
                                  borderColor: alpha(theme.border, 0.7),
                                  backgroundColor: theme.appearance === "dark" ? "#ffffff0f" : theme.muted,
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                        <BannerText truncate grow color={alpha(theme.foreground, 0.8)}>
                          {previewText}
                        </BannerText>
                      </BannerContent>
                      <BannerActions>
                        {isEditing ? (
                          <QueueTextButton
                            testId={`queued-run-${index}-cancel-edit`}
                            label="Cancel"
                            onClick={props.onCancelEdit}
                          />
                        ) : (
                          <>
                            {props.onEditQueuedRun ? (
                              <Tooltip content="Edit in the composer" side="top">
                                <BannerIconButton
                                  icon="pencil"
                                  testId={`queued-run-${index}-edit`}
                                  disabled={busyRunId !== null || !props.canOperateThread}
                                  onClick={() =>
                                    props.onEditQueuedRun?.({
                                      runId: run.id,
                                      messageId: run.userMessageId,
                                      text,
                                      attachments,
                                    })
                                  }
                                />
                              </Tooltip>
                            ) : null}
                            <Tooltip
                              content={workflow?.canSendNow ? "Start a turn with this message" : "Send as a steer instead"}
                              side="top"
                            >
                              <QueueTextButton
                                testId={`queued-run-${index}-steer`}
                                icon="corner-up-right"
                                label={workflow?.canSendNow ? "Send now" : "Steer"}
                                disabled={busyRunId !== null || !canSend}
                                onClick={() => void sendQueuedMessage(run.id)}
                              />
                            </Tooltip>
                            <Tooltip content="Remove from queue" side="top">
                              <BannerIconButton
                                icon="x"
                                testId={`queued-run-${index}-remove`}
                                disabled={busyRunId !== null || !props.canOperateThread}
                                onClick={() => void remove(run.id)}
                              />
                            </Tooltip>
                          </>
                        )}
                      </BannerActions>
                    </BannerRow>
                  </div>
                  {drag && index === queued.length - 1 && drag.insertIndex === queued.length ? indicator : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </BannerRoot>
    </BannerAttachment>
  );
}

/** Button size xs, variant ghost-muted: 24 tall, 12px label, optional 14px icon. */
function QueueTextButton({
  label,
  icon,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  icon?: "corner-up-right";
  disabled?: boolean;
  onClick?: () => void;
  testId: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 24,
        paddingLeft: 7,
        paddingRight: 7,
        borderRadius: RADIUS.md,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      {icon ? <Icon name={icon} size={14} color={theme.mutedForeground} /> : null}
      <BannerText weight={500} color={theme.mutedForeground}>
        {label}
      </BannerText>
    </div>
  );
}
