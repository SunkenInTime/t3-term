// The share half of apps/web/src/components/settings/AuthorizedClientsSettings.tsx
// PairingLinkListRow, with apps/web/src/components/ui/qr-code.tsx: a pairing
// link's full URL, its QR code, copy actions, and the reveal dialog shown when
// the clipboard refuses the value.
//
// Web shares a URL on the origin it was served from, unless that origin is
// loopback (a link to localhost would make the other device dial itself). Its
// endpoint picker lists what the desktop app advertises, which the browser build
// never has. t3-term has no origin of its own; the server URL it connected to
// plays that part, under the same loopback rule.
import { QrCode } from "@t3tools/shared/qrCode";
import { setPairingTokenOnUrl } from "@t3tools/shared/remote";
import { memo, useState } from "react";

import { copyToClipboard } from "../../lib/clipboard.ts";
import { Dialog, Tooltip } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { fieldBackground } from "../controls.tsx";

/** apps/web/src/environments/primary/target.ts LOOPBACK_HOSTNAMES. */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(
    hostname
      .trim()
      .toLowerCase()
      .replace(/^\[(.*)\]$/, "$1"),
  );
}

/** web resolveCurrentOriginPairingUrl, with the connected server standing in for the page origin. */
export function resolveShareablePairingUrl(serverUrl: string | null, credential: string): string | null {
  if (!serverUrl) return null;
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return null;
  }
  if (isLoopbackHostname(url.hostname)) return null;
  const pairUrl = new URL("/pair", url);
  return setPairingTokenOnUrl(pairUrl, credential).toString();
}

// ── qr-code.tsx ─────────────────────────────────────────────────────────

function buildQrPathData(qrCode: ReturnType<typeof QrCode.encodeText>, marginSize: number): string {
  const commands: string[] = [];
  for (let y = 0; y < qrCode.size; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= qrCode.size; x += 1) {
      const isDark = x < qrCode.size && qrCode.getModule(x, y);
      if (isDark) {
        if (runStart === -1) runStart = x;
        continue;
      }
      if (runStart === -1) continue;
      commands.push(`M${runStart + marginSize} ${y + marginSize}h${x - runStart}v1H${runStart + marginSize}z`);
      runStart = -1;
    }
  }
  return commands.join("");
}

/**
 * web QRCodeSvg (level M). gpuix's <svg> is a single tinted colour, so the
 * code is drawn as a two-colour SVG through <img>, which renders it with usvg.
 */
export const PairingQrCode = memo(function PairingQrCode({ value, size, marginSize }: { value: string; size: number; marginSize: number }) {
  const qrCode = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
  const viewBoxSize = qrCode.size + marginSize * 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" width="${size}" height="${size}" shape-rendering="crispEdges">` +
    `<rect width="${viewBoxSize}" height="${viewBoxSize}" fill="#fff"/>` +
    `<path d="${buildQrPathData(qrCode, marginSize)}" fill="#000"/></svg>`;
  return <img src={`data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`} style={{ width: size, height: size }} />;
});

// ── Copy ────────────────────────────────────────────────────────────────

type CopyKind = "code" | "link";

/** web useCopyToClipboard onCopy / onError for pairing values. */
export function usePairingCopy() {
  const [failedCopyValue, setFailedCopyValue] = useState<string | null>(null);
  const copy = (value: string, kind: CopyKind) => {
    void copyToClipboard(value).then((copied) => {
      if (copied) {
        toast({
          type: "success",
          title: kind === "link" ? "Pairing URL copied" : "Pairing code copied",
          description: kind === "link" ? "Open it in the client you want to pair to this environment." : "Paste it into another client to finish pairing.",
        });
        return;
      }
      // Captured per attempt, so the reveal shows the value that failed.
      setFailedCopyValue(value);
      toast({
        type: "error",
        title: kind === "link" ? "Could not copy pairing URL" : "Could not copy pairing code",
        description: "Showing the full value instead.",
      });
    });
  };
  return { copy, failedCopyValue, clearFailedCopy: () => setFailedCopyValue(null) };
}

/** web's reveal dialog: the value to copy by hand, and its QR code when it is a URL. */
export function PairingRevealDialog({
  value,
  credential,
  onClose,
  onCopyCode,
}: {
  value: string | null;
  credential: string;
  onClose: () => void;
  onCopyCode: () => void;
}) {
  const theme = useTheme();
  const isUrl = value !== null && value !== credential;
  return (
    <Dialog
      open={value !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width={448}
      showCloseButton
      testId="pairing-reveal-dialog"
      title={isUrl ? "Pairing link" : "Pairing code"}
      description={
        isUrl
          ? "Clipboard copy is unavailable here. Open or manually copy this full pairing URL on the device you want to connect."
          : "Clipboard copy is unavailable here. Manually copy this code into another client."
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button variant="outline" onClick={onCopyCode}>
            Copy code
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <textarea
          testId="pairing-reveal-value"
          value={value ?? ""}
          readOnly
          minRows={isUrl ? 4 : 3}
          maxRows={isUrl ? 4 : 3}
          theme={{ caret: theme.foreground, textMuted: theme.mutedForeground, appearance: theme.appearance }}
          style={{
            width: "100%",
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: fieldBackground(theme),
            color: theme.foreground,
            fontSize: 14,
            lineHeight: 20,
            fontFamily: FONTS.sans,
          }}
        />
        {isUrl ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 16, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: alpha(theme.border, 0.6), backgroundColor: alpha(theme.muted, 0.3) }}>
            <PairingQrCode value={value} size={132} marginSize={2} />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/** The panel Share opens under the row: the URL with Copy link, Copy code only, and the QR code. */
export function PairingSharePanel({ url, onCopyLink, onCopyCode }: { url: string; onCopyLink: () => void; onCopyCode: () => void }) {
  const theme = useTheme();
  return (
    <div
      testId="pairing-share-panel"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderColor: alpha(theme.border, 0.5),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            width: "100%",
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 6,
            paddingBottom: 6,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.6),
            backgroundColor: alpha(theme.muted, 0.3),
          }}
        >
          <Tooltip content={url} side="top" rootStyle={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
            <div style={{ display: "flex", minWidth: 0 }}>
              <Text size="2xs" mono color={theme.mutedForeground} truncate testId="pairing-share-url">
                {url}
              </Text>
            </div>
          </Tooltip>
          <Button size="xs" variant="ghost" onClick={onCopyLink} testId="pairing-share-copy-link">
            Copy link
          </Button>
        </div>
        <Button size="xs" variant="ghost" onClick={onCopyCode} testId="pairing-share-copy-code">
          Copy code only
        </Button>
      </div>
      <div style={{ display: "flex", flexShrink: 0, padding: 12, borderRadius: RADIUS.xl, backgroundColor: "#ffffff" }}>
        <PairingQrCode value={url} size={168} marginSize={1} />
      </div>
    </div>
  );
}
