// apps/web/src/components/chat/WorkflowOpeningBlock.tsx: a workflow
// coordinator's thread opens with its plan instead of the raw script message:
// the workflow's name and description, its agents by phase (each opening its
// thread), then the script as a JavaScript code block, folded like a long
// message.
import {
  isTerminalSubagentStatus,
  workflowOpeningHeadline,
  type RuntimeSubagent,
  type WorkflowOpening,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type { EnvironmentId, OrchestrationV2TurnItem, ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { memo, useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { shouldCollapseUserMessage } from "../../web/components/chat/MessagesTimeline.logic.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import { AgentElapsed, EnvironmentSubagentAvatar } from "./EventRows.tsx";
import { useHover } from "./parts.tsx";

/** The script as a fenced block, so it renders like any other code in the thread. */
function scriptMarkdown(script: string) {
  const longestRun = Math.max(2, ...(script.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  return `${fence}javascript\n${script.trimEnd()}\n${fence}`;
}

export const WorkflowOpeningBlock = memo(function WorkflowOpeningBlock(props: {
  readonly opening: WorkflowOpening;
  readonly environmentId: EnvironmentId;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const theme = useTheme();
  const { opening } = props;
  const headline = workflowOpeningHeadline(opening);
  const phases = opening.group?.phases.filter((phase) => phase.members.length > 0) ?? [];
  const memberRow = (member: RuntimeSubagent) =>
    opening.providerInstanceId === null ? null : (
      <WorkflowMemberRow
        key={member.id}
        member={member}
        environmentId={props.environmentId}
        providerInstanceId={opening.providerInstanceId}
        driver={opening.driver ?? undefined}
        onOpenThread={props.onOpenThread}
      />
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, width: "100%", paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
        <div style={{ marginTop: 2, display: "flex" }}>
          <Icon name="workflow" size={14} color={theme.mutedForeground} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
          <Text size="2xs" weight={500} color={theme.mutedForeground}>
            Workflow started
          </Text>
          <Text size="sm" weight={500} truncate>
            {headline.title}
          </Text>
          {headline.description ? (
            <Text size="xs" color={theme.mutedForeground}>
              {headline.description}
            </Text>
          ) : null}
        </div>
        {headline.agents ? (
          <Text size="2xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
            {headline.agents}
          </Text>
        ) : null}
      </div>
      {phases.map((phase) => (
        <div key={phase.index} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 8, paddingLeft: 8, paddingRight: 8, paddingBottom: 2 }}>
            <Text size="2xs" weight={500} color={theme.mutedForeground} truncate>
              {phase.title}
            </Text>
            <Text size="2xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
              {`${phase.settledCount}/${phase.members.length}`}
            </Text>
          </div>
          {phase.members.map(memberRow)}
        </div>
      ))}
      {opening.group && opening.group.unphasedMembers.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column" }}>{opening.group.unphasedMembers.map(memberRow)}</div>
      ) : null}
      <WorkflowScript script={opening.script} />
    </div>
  );
});

function WorkflowMemberRow(props: {
  readonly member: RuntimeSubagent;
  readonly environmentId: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind | undefined;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const theme = useTheme();
  const [hovered, hover] = useHover();
  const { member } = props;
  const threadId = member.childThreadId as ThreadId | null;
  const failed = member.status === "failed";
  const detail = (isTerminalSubagentStatus(member.status) ? (member.error ?? member.result ?? member.progress) : member.progress)
    ?.replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const status = member.status as OrchestrationV2TurnItem["status"];
  return (
    <div
      {...hover}
      onClick={threadId ? () => props.onOpenThread(threadId) : undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        width: "100%",
        minWidth: 0,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 6,
        paddingBottom: 6,
        borderRadius: RADIUS.md,
        ...(threadId ? { cursor: "pointer" as const, hover: { backgroundColor: alpha(theme.accent, 0.2) } } : {}),
      }}
    >
      <EnvironmentSubagentAvatar environmentId={props.environmentId} providerInstanceId={props.providerInstanceId} driver={props.driver} status={status} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <Text size="xs" weight={500} truncate>
          {member.title}
        </Text>
        {detail ? (
          <text
            style={{
              color: failed ? theme.errorForeground : theme.mutedForeground,
              fontSize: 11,
              lineHeight: 18,
              fontFamily: FONTS.sans,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            {detail}
          </text>
        ) : null}
      </div>
      {member.startedAt ? (
        <Text size="xs" color={theme.mutedForeground} style={{ flexShrink: 0 }}>
          <AgentElapsed agent={{ status, startedAt: member.startedAt, completedAt: member.completedAt }} />
        </Text>
      ) : null}
      {threadId ? <Icon name="chevron-right" size={14} color={hovered ? theme.foreground : alpha(theme.mutedForeground, 0.6)} /> : null}
    </div>
  );
}

/** The script, folded to max-h-44 like a long message until opened. */
function WorkflowScript(props: { readonly script: string }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const canFold = shouldCollapseUserMessage(props.script);
  const folded = canFold && !expanded;
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ position: "relative", minWidth: 0, ...(folded ? { height: 176, overflow: "hidden" } : {}) }}>
        <ChatMarkdown text={scriptMarkdown(props.script)} tone="assistant" />
        {folded ? (
          // The mask fades the last 1.75rem.
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 28,
              background: { type: "linear-gradient", angle: 180, stops: [{ color: alpha(theme.background, 0), position: 0 }, { color: theme.background, position: 1 }] },
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
      {canFold ? (
        <div style={{ display: "flex", flexDirection: "row", marginLeft: -4 }}>
          <Button size="xs" variant="ghost-muted" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show less" : "Show full script"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
