// Port of apps/web/src/components/preview/PreviewUnreachable.tsx.
import { useState } from "react";

import { describePreviewError } from "../../web/components/preview/errorCodeMessages.ts";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";

const ERROR_ICON = `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" xmlns="http://www.w3.org/2000/svg"><path d="M16 12 L48 12 L48 52 L16 52 Z"/><path d="M22 22 L42 22 M22 30 L36 30 M22 38 L40 38" stroke-linecap="round"/><path d="M52 8 L12 56" stroke-linecap="round"/></svg>`;

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", backgroundColor: theme.background }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          width: "100%",
          maxWidth: 576,
          alignSelf: "center",
          paddingLeft: 32,
          paddingRight: 32,
          paddingTop: 64,
          paddingBottom: 64,
        }}
      >
        <svg source={ERROR_ICON} style={{ width: 48, height: 48, marginBottom: 24, color: alpha(theme.mutedForeground, 0.7) }} />
        {children}
      </div>
    </div>
  );
}

export function PreviewUnreachable({
  url,
  code,
  description,
  onReload,
}: {
  url: string;
  code: number;
  description: string;
  onReload: () => void;
}) {
  const theme = useTheme();
  const [showDetails, setShowDetails] = useState(false);
  const host = safeHost(url) ?? url;
  const friendly = describePreviewError(description);
  const errorLabel = description.length > 0 ? description : `ERR_${Math.abs(code) || "FAILED"}`;
  return (
    <Frame>
      <Text size="2xl" weight={600} style={{ marginBottom: 12 }} testId="preview-unreachable">
        This site can’t be reached
      </Text>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap" }}>
        <text style={{ color: theme.foreground, fontSize: 14, lineHeight: 23, fontWeight: 600, fontFamily: FONTS.sans }}>{host}</text>
        <text style={{ color: theme.mutedForeground, fontSize: 14, lineHeight: 23, fontFamily: FONTS.sans }}>{`: ${friendly}.`}</text>
      </div>
      {showDetails ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginTop: 24,
            padding: 16,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: alpha(theme.muted, 0.4),
          }}
        >
          <Text weight={500} style={{ marginBottom: 4 }}>
            Try:
          </Text>
          {["Checking your connection", "Confirming the dev server is running", "Checking the proxy and the firewall"].map((line) => (
            <Text key={line} color={theme.mutedForeground}>
              {`•  ${line}`}
            </Text>
          ))}
        </div>
      ) : null}
      <Text size="xs" color={alpha(theme.mutedForeground, 0.7)} style={{ marginTop: 32 }}>
        {errorLabel.toUpperCase()}
      </Text>
      <div style={{ flexGrow: 1 }} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 32 }}>
        <Button variant="outline" size="sm" onClick={() => setShowDetails((value) => !value)}>
          {showDetails ? "Hide details" : "Details"}
        </Button>
        <div style={{ flexGrow: 1 }} />
        <Button size="sm" onClick={onReload} testId="preview-unreachable-reload">
          Reload
        </Button>
      </div>
    </Frame>
  );
}

export function PreviewFileNotShown({
  url,
  fileName,
  onOpen,
  onDownload,
}: {
  url: string;
  fileName: string;
  onOpen: () => void;
  onDownload: (() => void) | null;
}) {
  const theme = useTheme();
  const host = safeHost(url) ?? url;
  return (
    <Frame>
      <Text size="2xl" weight={600} style={{ marginBottom: 12 }}>
        This file can’t be shown here
      </Text>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap" }}>
        <text style={{ color: theme.foreground, fontSize: 14, lineHeight: 23, fontWeight: 600, fontFamily: FONTS.sans }}>{fileName}</text>
        <text style={{ color: theme.mutedForeground, fontSize: 14, lineHeight: 23, fontFamily: FONTS.sans }}>{` from ${host} was downloaded instead.`}</text>
      </div>
      <div style={{ flexGrow: 1 }} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 32 }}>
        <div style={{ flexGrow: 1 }} />
        <Button variant="outline" size="sm" onClick={onOpen}>
          Open in browser
        </Button>
        {onDownload ? (
          <Button size="sm" onClick={onDownload}>
            Download
          </Button>
        ) : null}
      </div>
    </Frame>
  );
}
