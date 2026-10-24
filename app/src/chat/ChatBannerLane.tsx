// apps/web/src/components/chat/ChatBannerLane.tsx + ProviderStatusBanner.tsx: the notices
// pinned above the timeline. The thread error banner stays at the top of the timeline
// (timeline/ThreadErrorBanner.tsx), right under this lane, as web stacks them.
//
// Web floats the lane over the timeline (absolute, z-30). In a thread t3-term keeps it in
// flow above the timeline, like the thread error banner, because gpuix has no z-index
// and the timeline is a scroller; in a draft, where nothing scrolls under it, it floats.
import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { routeAtom } from "../state/ui.ts";
import { Icon } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { formatProviderDriverKindLabel } from "../web/providerModels.ts";
import {
  getIncompatibleVersion,
  getProviderStatusBannerKey,
  getProviderStatusMessage,
  hasProviderSetup,
  shouldShowProviderStatusBanner,
} from "../web/components/chat/ProviderStatusBanner.logic.ts";
import { composerProviderStatusAtom, dismissedProviderStatusBannerKeyAtom } from "./composer/composerProviderStatus.ts";

export function ChatBannerLane({ composerTargetKey, overlay = false }: { composerTargetKey: string; overlay?: boolean }) {
  const status = useAtomValue(composerProviderStatusAtom(composerTargetKey));
  const dismissedKey = useAtomValue(dismissedProviderStatusBannerKeyAtom);
  const bannerKey = getProviderStatusBannerKey(status);
  // web: a provider that recovers forgets the dismissal, so a later failure shows again.
  useEffect(() => {
    if (bannerKey === null && dismissedKey !== null) appAtomRegistry.set(dismissedProviderStatusBannerKeyAtom, null);
  }, [bannerKey, dismissedKey]);
  if (!status || !shouldShowProviderStatusBanner(status, dismissedKey)) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        paddingTop: 12,
        paddingLeft: 16,
        paddingRight: 16,
        flexShrink: 0,
        ...(overlay ? { position: "absolute", top: 0, left: 0, right: 0 } : {}),
      }}
    >
      <ProviderStatusBanner
        status={status}
        onDismiss={() => appAtomRegistry.set(dismissedProviderStatusBannerKeyAtom, bannerKey)}
        onOpenProviderSetup={() => appAtomRegistry.set(routeAtom, { kind: "settings", page: "providers" })}
      />
    </div>
  );
}

/** web ProviderStatusBanner: an Alert (glass surface, first-line controls) with title, clamped message and setup link. */
function ProviderStatusBanner({
  status,
  onDismiss,
  onOpenProviderSetup,
}: {
  status: ServerProvider;
  onDismiss: () => void;
  onOpenProviderSetup: () => void;
}) {
  const theme = useTheme();
  const [setupHovered, setSetupHovered] = useState(false);
  const providerName = status.displayName?.trim() || formatProviderDriverKindLabel(status.driver);
  const isUnauthenticated = status.status === "error" && status.auth.status === "unauthenticated";
  const incompatible = getIncompatibleVersion(status);
  const title = isUnauthenticated
    ? `${providerName} is unauthenticated`
    : incompatible
      ? `${providerName} ${status.version ?? ""} is ${incompatible.status === "broken" ? "known to be broken" : "unsupported"}`
      : `${providerName} provider status`;
  const message = incompatible?.message ?? getProviderStatusMessage(status);
  const isWarning = incompatible?.status !== "broken" && (status.status === "warning" || incompatible !== null);
  const tone = isWarning ? theme.warning : theme.error;
  const toneForeground = isWarning ? theme.warningForeground : theme.errorForeground;
  return (
    <div
      testId="provider-status-banner"
      style={{ display: "flex", maxWidth: 768, minWidth: 0, borderRadius: RADIUS.xl, backgroundColor: alpha(theme.background, 0.8), pointerEvents: "auto" }}
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
          paddingTop: 14,
          paddingBottom: 12,
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: alpha(tone, 0.32),
          backgroundColor: alpha(tone, 0.04),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 20, flexShrink: 0 }}>
          <Icon name="info" size={16} color={tone} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
          <Text size="sm" weight={500} color={toneForeground}>
            {title}
          </Text>
          <Tooltip content={message} side="top">
            <div style={{ display: "flex", minWidth: 0 }}>
              <text style={{ color: alpha(toneForeground, 0.8), fontSize: 14, lineHeight: 20, fontFamily: FONTS.sans, lineClamp: 3 }}>
                {message}
              </text>
            </div>
          </Tooltip>
          {hasProviderSetup(status) ? (
            <div
              testId="provider-status-open-setup"
              onClick={onOpenProviderSetup}
              onMouseEnter={() => setSetupHovered(true)}
              onMouseLeave={() => setSetupHovered(false)}
              style={{ display: "flex", flexDirection: "row", cursor: "pointer" }}
            >
              <Text size="sm" weight={500} color={toneForeground} style={setupHovered ? { textDecoration: "underline" } : {}}>
                Open provider setup
              </Text>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0, height: 20 }}>
          <IconButton icon="x" size={24} iconSize={14} onClick={onDismiss} testId="dismiss-provider-status" />
        </div>
      </div>
    </div>
  );
}
