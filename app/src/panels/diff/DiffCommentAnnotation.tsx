// Port of apps/web/src/components/diffs/DiffCommentAnnotation.tsx: the comment form a
// diff or file line opens (draft) and the comment it leaves behind once sent to the
// composer (comment). Shared by the Diff surface and the Files editor.
import type { EventPayload } from "@gpuix/native";
import type { KeyEvent } from "@gpuix/react";
import { useEffect, useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { FONTS, alpha, useTheme } from "../../ui/theme.ts";
import { isCommentSubmitShortcut } from "../../web/components/diffs/commentSubmitShortcut.ts";

export interface DiffCommentAnnotationProps {
  readonly kind: "draft" | "comment";
  readonly rangeLabel: string;
  readonly text: string;
  readonly onTextChange?: (text: string) => void;
  readonly onCancel: () => void;
  readonly onComment: (text: string) => void;
  readonly onDelete?: () => void;
  readonly placeholder?: string;
  readonly submitLabel?: string;
  readonly pending?: boolean;
  readonly focusOnMount?: boolean;
  readonly testId?: string;
}

export function DiffCommentAnnotation({
  kind,
  rangeLabel,
  text,
  onTextChange,
  onCancel,
  onComment,
  onDelete,
  placeholder = "Add a comment…",
  submitLabel = "Comment",
  pending = false,
  focusOnMount = true,
  testId,
}: DiffCommentAnnotationProps) {
  const theme = useTheme();
  const [localDraftText, setLocalDraftText] = useState("");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // A textarea that takes focus in the frame its virtual-list row first appears makes
  // the list jump that row to the top. Mount it unfocused, then remount it focused once
  // the row has been laid out (web focuses on the next animation frame too).
  const [focusReady, setFocusReady] = useState(false);
  useEffect(() => {
    if (kind !== "draft" || !focusOnMount) return;
    const timer = setTimeout(() => {
      setFocusReady(true);
      // autoFocus moves focus without an onFocus event.
      setFocused(true);
    }, 32);
    return () => clearTimeout(timer);
  }, [kind, focusOnMount]);
  const displayedText = kind === "draft" && !onTextChange ? localDraftText : text;
  const trimmedText = displayedText.trim();

  if (kind === "comment") {
    // border-s-2 border-primary/55 bg-primary/[0.045] px-3 py-2.5, trash on hover.
    return (
      <div
        {...(testId ? { testId } : {})}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 10,
          width: "100%",
          paddingLeft: 10,
          paddingRight: 12,
          paddingTop: 10,
          paddingBottom: 10,
          borderLeftWidth: 2,
          borderColor: alpha(theme.primary, 0.55),
          backgroundColor: alpha(theme.primary, 0.045),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", height: 20, flexShrink: 0 }}>
          <Icon name="message-circle" size={14} color={alpha(theme.primary, 0.7)} />
        </div>
        <text
          style={{
            flexGrow: 1,
            flexShrink: 1,
            minWidth: 0,
            color: theme.foreground,
            fontSize: 14,
            lineHeight: 20,
            fontFamily: FONTS.sans,
          }}
        >
          {displayedText}
        </text>
        {onDelete ? (
          <div style={{ display: "flex", flexShrink: 0, marginTop: -4, marginBottom: -4, marginRight: -4, opacity: hovered ? 1 : 0 }}>
            <IconButton
              icon="trash-2"
              size={24}
              iconSize={12}
              testId={testId ? `${testId}-delete` : undefined}
              onClick={onDelete}
            />
          </div>
        ) : null}
      </div>
    );
  }

  // Textarea size="sm": min-h 66, px 9, py 3, rounded-lg, border-input, bg input/32 (dark).
  return (
    <div
      {...(testId ? { testId } : {})}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
      }}
    >
      <textarea
        testId={testId ? `${testId}-input` : undefined}
        aria-label={`Comment on lines ${rangeLabel}`}
        key={focusReady ? "focused" : "mounting"}
        autoFocus={focusReady}
        value={displayedText}
        placeholder={placeholder}
        minRows={3}
        maxRows={12}
        onChange={(event: EventPayload) => (onTextChange ?? setLocalDraftText)(String(event.value ?? ""))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event: KeyEvent) => {
          if (event.key === "escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
            return;
          }
          const shortcut = {
            key: event.key === "enter" ? "Enter" : (event.key ?? ""),
            metaKey: event.modifiers?.cmd === true,
            ctrlKey: event.modifiers?.ctrl === true,
          };
          if (isCommentSubmitShortcut(shortcut, trimmedText, pending)) {
            event.preventDefault();
            event.stopPropagation();
            onComment(trimmedText);
          }
        }}
        theme={{ caret: theme.foreground }}
        style={{
          width: "100%",
          paddingTop: 3,
          paddingBottom: 3,
          paddingLeft: 9,
          paddingRight: 9,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: focused ? theme.primary : theme.input,
          backgroundColor: theme.appearance === "dark" ? alpha(theme.input, 0.32) : theme.background,
          color: theme.foreground,
          fontSize: 14,
          lineHeight: 20,
          fontFamily: FONTS.sans,
          selectionColor: alpha(theme.primary, 0.4),
        }}
      />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <Text size="3xs" color={alpha(theme.mutedForeground, 0.7)}>
            ⌘/Ctrl Enter to send
          </Text>
        </div>
        <Button variant="ghost-muted" size="xs" onClick={onCancel} testId={testId ? `${testId}-cancel` : undefined}>
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={pending || !trimmedText}
          onClick={() => onComment(trimmedText)}
          testId={testId ? `${testId}-submit` : undefined}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
