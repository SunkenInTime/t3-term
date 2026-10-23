// Port of apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx and
// ComposerPendingApprovalActions.tsx: the approval banner's text and its buttons.
import {
  FULL_ACCESS_OVERRIDE_QUESTION,
  fullAccessOverrideExplanation,
  type ThreadPendingApproval,
} from "@t3tools/client-runtime/state/thread-requests";
import type { ProviderApprovalDecision, ProviderApprovalOption, RuntimeRequestId } from "@t3tools/contracts";
import { memo } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Menu, MenuItem, Tooltip } from "../../ui/overlay.tsx";
import { Button } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { BannerText } from "./ComposerBannerParts.tsx";

function approvalLabel(kind: ThreadPendingApproval["requestKind"]) {
  return kind === "mcp-elicitation"
    ? "App access approval"
    : kind === "command"
      ? "Command approval"
      : kind === "file-read"
        ? "File read approval"
        : kind === "permission"
          ? "App permission approval"
          : "File change approval";
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
}: {
  approval: ThreadPendingApproval;
  pendingCount: number;
}) {
  const theme = useTheme();
  const fallbackLabel = approvalLabel(approval.requestKind);
  const isElicitation = approval.requestKind === "mcp-elicitation";
  const detail =
    approval.responseCapability === "not_resumable"
      ? "Provider process is gone. Interrupt or restart the run to respond."
      : approval.detail || fallbackLabel;
  return (
    <div
      testId="approval-panel"
      style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, flexGrow: 1, minWidth: 0 }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>
        <BannerText size="2xs" weight={500} color={theme.warning}>
          {fallbackLabel}
        </BannerText>
        {approval.appName ? (
          <BannerText size="2xs" color={theme.mutedForeground} truncate>
            {approval.appName}
          </BannerText>
        ) : null}
        {approval.fullAccessOverride ? (
          <Tooltip content={fullAccessOverrideExplanation(approval.fullAccessOverride)} side="top">
            <div testId="approval-override-why" style={{ display: "flex", cursor: "pointer", flexShrink: 0 }}>
              <BannerText
                size="2xs"
                color={theme.mutedForeground}
                style={{ textDecoration: "underline", hover: { color: theme.foreground } }}
              >
                {FULL_ACCESS_OVERRIDE_QUESTION}
              </BannerText>
            </div>
          </Tooltip>
        ) : null}
        {pendingCount > 1 ? (
          <>
            <div style={{ flexGrow: 1 }} />
            <BannerText size="2xs" color={theme.mutedForeground}>
              {`1/${pendingCount}`}
            </BannerText>
          </>
        ) : null}
      </div>
      <div
        testId="approval-detail"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          minWidth: 0,
          maxHeight: isElicitation ? 80 : 160,
          overflowY: "scroll",
          scrollbarWidth: 6,
          scrollbarColor: theme.scrollbar,
        }}
      >
        {detail.split("\n").map((line, index) => (
          <BannerText key={index} mono={!isElicitation} color={theme.foreground} style={{ flexShrink: 0 }}>
            {line.length === 0 ? " " : line}
          </BannerText>
        ))}
      </div>
      {approval.reason ? (
        <BannerText size="2xs" color={theme.mutedForeground}>
          {approval.reason}
        </BannerText>
      ) : null}
    </div>
  );
});

const DEFAULT_APPROVAL_OPTIONS = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: "Always allow this session" },
  { decision: "accept", label: "Approve" },
] satisfies ReadonlyArray<ProviderApprovalOption>;

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  canRespond,
  disabled = false,
  options = DEFAULT_APPROVAL_OPTIONS,
  onRespondToApproval,
}: {
  requestId: RuntimeRequestId;
  isResponding: boolean;
  canRespond: boolean;
  disabled?: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  onRespondToApproval: (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => Promise<unknown>;
}) {
  const theme = useTheme();
  const primaryOptions = options.filter((option) => option.decision === "decline" || option.decision === "accept");
  const moreOptions = options.filter((option) => option.decision !== "decline" && option.decision !== "accept");
  const respond = (decision: ProviderApprovalDecision) => {
    if (!disabled && !isResponding) void onRespondToApproval(requestId, decision);
  };
  return (
    <>
      {primaryOptions.map((option) => {
        const button = (
          <ApprovalButton
            key={option.decision}
            testId={`approval-${option.decision}`}
            label={option.label}
            warning={option.warning !== undefined}
            primary={option.decision === "accept"}
            disabled={disabled || isResponding || !canRespond}
            onClick={() => respond(option.decision)}
          />
        );
        return option.warning ? (
          <Tooltip key={option.decision} content={option.warning} side="top">
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
      {moreOptions.length > 0 ? (
        <Menu
          side="top"
          align="end"
          testId="approval-more-menu"
          trigger={({ toggle }) => (
            <div
              testId="approval-more"
              onClick={disabled || isResponding ? undefined : toggle}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                borderRadius: RADIUS.md,
                borderWidth: 1,
                borderColor: theme.input,
                backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.026) : theme.popover,
                opacity: disabled || isResponding ? 0.64 : 1,
                cursor: disabled || isResponding ? "default" : "pointer",
                flexShrink: 0,
                ...(disabled || isResponding
                  ? {}
                  : { hover: { backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.05) : theme.accent } }),
              }}
            >
              <Icon name="ellipsis" size={14} color={theme.mutedForeground} />
            </div>
          )}
        >
          {moreOptions.map((option) => (
            <MenuItem
              key={option.decision}
              testId={`approval-${option.decision}`}
              disabled={disabled || isResponding}
              description={option.warning}
              trailing={option.warning ? <Icon name="triangle-alert" size={12} color={theme.warning} /> : undefined}
              onSelect={() => respond(option.decision)}
            >
              {option.label}
            </MenuItem>
          ))}
        </Menu>
      ) : null}
    </>
  );
});

function ApprovalButton({
  label,
  primary,
  warning,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  primary: boolean;
  warning: boolean;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <Button
      testId={testId}
      size="xs"
      variant={primary ? "default" : "outline"}
      icon={warning ? "triangle-alert" : undefined}
      disabled={disabled}
      onClick={onClick}
      style={{ maxWidth: 176 }}
    >
      {label}
    </Button>
  );
}
