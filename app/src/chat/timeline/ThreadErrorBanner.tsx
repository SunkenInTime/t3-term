// apps/web/src/components/chat/ThreadErrorBanner.tsx with the ui/alert.tsx
// "glass" surface (rounded-xl, 1px tone/32 border, 4% tone tint) and
// settings/ExpandableText.tsx for long errors.
import type { OrchestrationV2ProviderFailureClass, ProviderDriverKind } from "@t3tools/contracts";
import {
  CHATGPT_USAGE_LIMIT_CODE,
  CHATGPT_USAGE_URL,
  CHATGPT_WORKSPACE_ADMIN_REQUEST,
  CHATGPT_WORKSPACE_USAGE_LIMIT_CODE,
} from "@t3tools/shared/usageLimits";
import { memo, useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { toast } from "../../ui/toast.tsx";
import { ProviderGlyph } from "./eventProviderIcon.tsx";
import { useHover } from "./parts.tsx";
import { copyTextToClipboard, openExternalUrl } from "./system.ts";

export function getThreadErrorBannerMessage(error: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(error);
  } catch {
    return error;
  }
  if (typeof payload !== "object" || payload === null || !("error" in payload)) return error;
  const nestedError = payload.error;
  if (typeof nestedError !== "object" || nestedError === null || !("message" in nestedError)) return error;
  return typeof nestedError.message === "string" && nestedError.message.trim().length > 0 ? nestedError.message : error;
}

function copyAdminRequest() {
  copyTextToClipboard(CHATGPT_WORKSPACE_ADMIN_REQUEST).then(
    () => toast({ type: "success", title: "Request copied", description: "Send it to your workspace admin." }),
    () => toast({ type: "error", title: "Could not copy the request" }),
  );
}

/** ExpandableText: three lines, then "Show full error" / "Show less". */
function ExpandableText({ text, collapsedText, color }: { text: string; collapsedText: string; color: string }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [hovered, hover] = useHover();
  const canExpand = collapsedText !== text || text.length > 180 || text.includes("\n");
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <text
        style={{
          color,
          fontSize: 14,
          lineHeight: 20,
          fontFamily: FONTS.sans,
          ...(!expanded && canExpand ? { lineClamp: 3 } : {}),
        }}
      >
        {expanded ? text : collapsedText}
      </text>
      {canExpand ? (
        <div {...hover} onClick={() => setExpanded((value) => !value)} style={{ display: "flex", flexDirection: "row", marginTop: 4, cursor: "pointer" }}>
          <Text
            size="sm"
            weight={500}
            color={hovered ? theme.foreground : theme.mutedForeground}
            style={hovered ? { textDecoration: "underline" } : {}}
          >
            {expanded ? "Show less" : "Show full error"}
          </Text>
        </div>
      ) : null}
    </div>
  );
}

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
  errorClass,
  errorCode,
}: {
  error: string | null;
  errorClass?: OrchestrationV2ProviderFailureClass | null;
  errorCode?: string | null;
  onDismiss?: () => void;
}) {
  const theme = useTheme();
  if (!error) return null;
  const workspaceLimit = errorCode === CHATGPT_WORKSPACE_USAGE_LIMIT_CODE;
  const chatGptLimit = workspaceLimit || errorCode === CHATGPT_USAGE_LIMIT_CODE;
  const variant = errorClass === "usage_limit" || chatGptLimit ? "warning" : "error";
  const tone = variant === "warning" ? theme.warning : theme.error;
  const toneForeground = variant === "warning" ? theme.warningForeground : theme.errorForeground;
  const hasAction = chatGptLimit || onDismiss !== undefined;
  return (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", paddingTop: 12, paddingLeft: 16, paddingRight: 16, flexShrink: 0 }}>
      <div
        testId="thread-error-banner"
        style={{ display: "flex", maxWidth: 768, minWidth: 0, borderRadius: RADIUS.xl, backgroundColor: alpha(theme.background, 0.8) }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
            minWidth: 0,
            paddingLeft: 14,
            paddingRight: 14,
            paddingTop: hasAction ? 14 : 12,
            paddingBottom: 12,
            borderRadius: RADIUS.xl,
            borderWidth: 1,
            borderColor: alpha(tone, 0.32),
            backgroundColor: alpha(tone, 0.04),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 20, flexShrink: 0 }}>
            {chatGptLimit ? (
              <ProviderGlyph driver={"codex" as ProviderDriverKind} displayName="Codex" size={16} />
            ) : (
              <Icon name="circle-alert" size={16} color={tone} />
            )}
          </div>
          {/* No zero flex-basis: the banner is w-fit, so the text's own width must size it. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
            {chatGptLimit ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <Text size="sm" weight={500} color={toneForeground}>
                  ChatGPT usage limit reached
                </Text>
                <Text size="sm" color={alpha(toneForeground, 0.8)}>
                  {workspaceLimit
                    ? "You've reached your workspace's limit for using your ChatGPT plan in other apps. Copy a request to ask your workspace admin for increased usage limits."
                    : "Review your usage settings in ChatGPT."}
                </Text>
              </div>
            ) : (
              <ExpandableText text={error} collapsedText={getThreadErrorBannerMessage(error)} color={alpha(toneForeground, 0.8)} />
            )}
          </div>
          {hasAction ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0, height: 20 }}>
              {workspaceLimit ? (
                <Button size="sm" onClick={copyAdminRequest}>
                  Copy request for admin
                </Button>
              ) : chatGptLimit ? (
                <Button size="sm" variant="ghost-muted" trailingIcon="external-link" onClick={() => openExternalUrl(CHATGPT_USAGE_URL)}>
                  Manage usage
                </Button>
              ) : null}
              {onDismiss ? <IconButton icon="x" size={24} iconSize={14} onClick={onDismiss} testId="dismiss-thread-error" /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
