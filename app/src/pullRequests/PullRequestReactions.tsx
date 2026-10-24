// Port of apps/web/src/components/pullRequest/PullRequestReactions.tsx: the reaction pills under a
// pull request remark, toggled in place (with the press shown before the host answers), and the
// smiley button that opens the eight-emoji picker.
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PullRequestReaction,
  PullRequestReactionContent,
  PullRequestRef,
} from "@t3tools/contracts";
import { useState } from "react";

import { pullRequestEnvironment } from "../state/pullRequests.ts";
import { Icon } from "../ui/Icon.tsx";
import { Popover, Tooltip } from "../ui/overlay.tsx";
import { toast } from "../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import {
  applyPendingPullRequestReactions,
  PULL_REQUEST_REACTION_ORDER,
  pullRequestReactionEmoji,
  pullRequestReactionName,
  pullRequestReactionTooltip,
} from "../web/components/pullRequest/pullRequestReactions.logic.ts";
import { PullRequestDryRunError, runPullRequestWrite } from "./pullRequestWrites.ts";

const EMPTY_PENDING: ReadonlyMap<PullRequestReactionContent, boolean> = new Map();

function reactionsSignature(reactions: ReadonlyArray<PullRequestReaction>): string {
  return reactions
    .map((reaction) => `${reaction.content}:${reaction.count}:${reaction.viewerHasReacted ? 1 : 0}`)
    .join(" ");
}

export function PullRequestReactionBar({
  reactions,
  canReact,
  subjectId,
  environmentId,
  reference,
  onRefresh,
  justifyEnd = false,
  testId,
}: {
  readonly reactions: ReadonlyArray<PullRequestReaction>;
  readonly canReact: boolean;
  /** Absent reacts to the change request itself, which is where its description's reactions live. */
  readonly subjectId?: string | undefined;
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly onRefresh: () => void;
  readonly justifyEnd?: boolean;
  readonly testId?: string;
}) {
  const theme = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<{
    readonly signature: string;
    readonly values: ReadonlyMap<PullRequestReactionContent, boolean>;
  }>({ signature: "", values: EMPTY_PENDING });
  const signature = reactionsSignature(reactions);
  const values = pending.signature === signature ? pending.values : EMPTY_PENDING;
  const shown = applyPendingPullRequestReactions(reactions, values);

  const toggle = async (content: PullRequestReactionContent, reacted: boolean) => {
    setPending({ signature, values: new Map([...values, [content, reacted]]) });
    const result = await runPullRequestWrite(pullRequestEnvironment.setReaction, {
      environmentId,
      input: {
        ...reference,
        ...(subjectId === undefined ? {} : { subjectId }),
        content,
        reacted,
      },
    });
    if (result._tag === "Failure") {
      setPending((current) => {
        const next = new Map(current.values);
        next.delete(content);
        return { signature: current.signature, values: next };
      });
      const failure = squashAtomCommandFailure(result);
      toast({
        type: "error",
        title: "The reaction could not be saved",
        ...(failure instanceof PullRequestDryRunError ? { description: failure.message } : {}),
      });
      return;
    }
    onRefresh();
  };

  if (shown.length === 0 && !canReact) return null;
  const pill = (active: boolean) => ({
    display: "flex" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    height: 24,
    paddingLeft: 8,
    paddingRight: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: active ? alpha(theme.primary, 0.6) : alpha(theme.border, 0.7),
    backgroundColor: active ? alpha(theme.primary, 0.1) : alpha(theme.muted, 0.4),
    flexShrink: 0,
  });
  return (
    <div
      testId={testId}
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 4,
        minWidth: 0,
        ...(justifyEnd ? { justifyContent: "flex-end", flexGrow: 1 } : {}),
      }}
    >
      {shown.map((reaction) => (
        <Tooltip key={reaction.content} content={pullRequestReactionTooltip(reaction)} side="top">
          <div
            testId={`pr-reaction-${reaction.content}`}
            onClick={canReact ? () => void toggle(reaction.content, !reaction.viewerHasReacted) : undefined}
            style={{
              ...pill(reaction.viewerHasReacted),
              cursor: canReact ? "pointer" : "default",
              ...(canReact ? { hover: { borderColor: alpha(theme.primary, 0.6) } } : {}),
            }}
          >
            <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>
              {pullRequestReactionEmoji(reaction.content)}
            </text>
            <text
              style={{
                color: reaction.viewerHasReacted ? theme.foreground : theme.mutedForeground,
                fontSize: 12,
                lineHeight: 16,
                fontFamily: FONTS.sans,
              }}
            >
              {String(reaction.count)}
            </text>
          </div>
        </Tooltip>
      ))}
      {canReact ? (
        <Popover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          side="top"
          align="start"
          testId="pr-reaction-picker"
          style={{ padding: 8 }}
          trigger={
            <Tooltip content="Add a reaction" side="top">
              <div
                testId="pr-reaction-add"
                onClick={() => setPickerOpen(!pickerOpen)}
                style={{
                  ...pill(false),
                  paddingLeft: 6,
                  paddingRight: 6,
                  backgroundColor: "#00000000",
                  cursor: "pointer",
                  hover: { borderColor: alpha(theme.primary, 0.6) },
                }}
              >
                <Icon name="smile-plus" size={14} color={theme.mutedForeground} />
              </div>
            </Tooltip>
          }
        >
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2 }}>
            {PULL_REQUEST_REACTION_ORDER.map((content) => {
              const reacted = shown.find((reaction) => reaction.content === content)?.viewerHasReacted ?? false;
              return (
                <Tooltip key={content} content={pullRequestReactionName(content)} side="top">
                  <div
                    testId={`pr-reaction-pick-${content}`}
                    onClick={() => {
                      setPickerOpen(false);
                      void toggle(content, !reacted);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      borderRadius: RADIUS.md,
                      cursor: "pointer",
                      backgroundColor: reacted ? alpha(theme.primary, 0.1) : "#00000000",
                      hover: { backgroundColor: theme.accent },
                    }}
                  >
                    <text style={{ color: theme.foreground, fontSize: 16, lineHeight: 24, fontFamily: FONTS.sans }}>
                      {pullRequestReactionEmoji(content)}
                    </text>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
