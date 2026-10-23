// Port of apps/web/src/components/preview/PreviewChromeRow.tsx in the panel's
// inline mode (h-7 row, mb-3, no border): back/forward/reload, the address
// field, open in system browser, float over chat, and trailing actions.
//
// Not ported: the annotate and capture buttons (web shows them only for desktop
// tabs) and the animated loading bar and spinning refresh icon (no continuous
// animation here); loading shows in the refresh tooltip.
import type { EventPayload, KeyEvent } from "@gpuix/react";
import { useGpuixRequired } from "@gpuix/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";

interface Props {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  refreshDisabled: boolean;
  inputDisabled?: boolean | undefined;
  focusUrlNonce?: number | undefined;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onSubmit: (url: string) => void;
  onOpenInBrowser?: (() => void) | undefined;
  onPictureInPicture?: (() => void) | undefined;
  pictureInPicture?: boolean | undefined;
  pictureInPictureDisabled?: boolean | undefined;
  trailingActions?: ReactNode;
  leadingActions?: ReactNode;
}

export function PreviewChromeRow({
  url,
  loading,
  canGoBack,
  canGoForward,
  refreshDisabled,
  inputDisabled,
  focusUrlNonce,
  onBack,
  onForward,
  onRefresh,
  onSubmit,
  onOpenInBrowser,
  onPictureInPicture,
  pictureInPicture,
  pictureInPictureDisabled,
  trailingActions,
  leadingActions,
}: Props) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const inputIdRef = useRef<number | null>(null);
  const [draft, setDraft] = useState(url);
  const [inputFocused, setInputFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (focusUrlNonce == null || inputIdRef.current === null) return;
    renderer.focusElement?.(inputIdRef.current);
    // Programmatic focus does not report onFocus, so enter the editing state here.
    if (renderer.getFocusedElementId?.() === inputIdRef.current) {
      setDraft(url);
      setInputFocused(true);
    }
  }, [focusUrlNonce]);

  const submit = () => {
    const next = draft.trim();
    if (next.length === 0) return;
    onSubmit(next);
    renderer.blur?.();
  };

  return (
    <div
      testId="preview-chrome-row"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 28,
        minHeight: 28,
        flexShrink: 0,
        marginBottom: 12,
        paddingLeft: 8,
        paddingRight: 8,
        backgroundColor: theme.background,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2 }}>
        <ChromeButton icon="arrow-left" label="Back" disabled={!canGoBack} onClick={onBack} testId="preview-back" />
        <ChromeButton icon="arrow-right" label="Forward" disabled={!canGoForward} onClick={onForward} testId="preview-forward" />
        <ChromeButton
          icon="refresh-cw"
          label={loading ? "Loading…" : "Refresh"}
          disabled={refreshDisabled}
          onClick={onRefresh}
          testId="preview-refresh"
        />
      </div>

      {leadingActions}

      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          flexGrow: 1,
          minWidth: 0,
          height: 28,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: inputFocused ? alpha(theme.primary, 0.8) : "#00000000",
          backgroundColor: inputFocused ? theme.background : hovered && !inputDisabled ? alpha(theme.muted, 0.4) : "#00000000",
          opacity: inputDisabled ? 0.64 : 1,
        }}
      >
        <input
          ref={(instance: { id: number } | null) => {
            inputIdRef.current = instance?.id ?? null;
          }}
          testId="preview-url-input"
          value={inputFocused ? draft : url}
          placeholder="Search or enter URL"
          readOnly={inputDisabled}
          onChange={(event: EventPayload) => setDraft(String(event.value ?? ""))}
          onFocus={() => {
            setDraft(url);
            setInputFocused(true);
          }}
          onBlur={() => setInputFocused(false)}
          onSubmit={submit}
          onKeyDown={(event: KeyEvent) => {
            if (event.key === "escape") {
              event.preventDefault();
              event.stopPropagation();
              setDraft(url);
              renderer.blur?.();
            }
          }}
          theme={{ caret: theme.foreground }}
          style={{
            flexGrow: 1,
            minWidth: 0,
            height: 26,
            paddingLeft: 8,
            paddingRight: 8,
            fontSize: 14,
            fontFamily: FONTS.sans,
            color: theme.foreground,
          }}
        />
        {onOpenInBrowser && !inputFocused && hovered ? (
          <ChromeButton icon="external-link" label="Open in system browser" onClick={onOpenInBrowser} testId="preview-open-external" />
        ) : null}
      </div>

      {onPictureInPicture ? (
        <ChromeButton
          icon="picture-in-picture-2"
          label={pictureInPicture ? "Close floating preview" : "Float preview over chat"}
          disabled={pictureInPictureDisabled}
          pressed={pictureInPicture}
          onClick={onPictureInPicture}
          testId="preview-pip"
        />
      ) : null}
      {trailingActions}
    </div>
  );
}

/** Button variant ghost, size icon-xs: 24px, radius 8, 14px muted icon. */
export function ChromeButton({
  icon,
  label,
  disabled,
  pressed,
  onClick,
  testId,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean | undefined;
  pressed?: boolean | undefined;
  onClick: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  const button = (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        flexShrink: 0,
        borderRadius: RADIUS.md,
        backgroundColor: pressed ? theme.secondary : "#00000000",
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      <Icon name={icon} size={14} color={pressed ? theme.primary : theme.mutedForeground} />
    </div>
  );
  return disabled ? button : <Tooltip content={label}>{button}</Tooltip>;
}
