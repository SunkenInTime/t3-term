// Port of apps/web/src/components/preview/PreviewEmptyState.tsx (+ PreviewLocalServerCard,
// ui/discovery-list.tsx and ui/empty.tsx as used there).
//
// The "Recently used" list is not ported: at the pinned commit web's
// browserHistoryStore never registers a thread's project (registerThreadProject
// has no caller), so every visit stays pending and the list never shows.
import type { EnvironmentId } from "@t3tools/contracts";

import { useDiscoveredLocalServers } from "../../state/preview.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";

interface Props {
  environmentId: EnvironmentId;
  configuredUrls?: ReadonlyArray<string> | undefined;
  onOpenUrl: (url: string) => void;
}

export function PreviewEmptyState({ environmentId, configuredUrls, onOpenUrl }: Props) {
  const theme = useTheme();
  const servers = useDiscoveredLocalServers(environmentId, configuredUrls);

  if (servers.length === 0) {
    // Empty (default size): p-12, gap-6; EmptyMedia "icon" adds mb-6; the description sits mt-1 under the title.
    return (
      <div testId="preview-empty-state" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 48 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            marginBottom: 48,
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.card,
          }}
        >
          <Icon name="globe" size={18} color={theme.mutedForeground} />
        </div>
        <Text size="xl" weight={600} style={{ textAlign: "center", marginBottom: 28 }}>
          No preview yet
        </Text>
        {/* text-balance has no gpuix equivalent; the width cap gives the same two even lines. */}
        <Text color={theme.mutedForeground} style={{ textAlign: "center", maxWidth: 340 }}>
          Type a URL above, or run a dev script. Browser-ready localhost servers will show up here automatically.
        </Text>
      </div>
    );
  }

  return (
    <div
      testId="preview-empty-state"
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minHeight: 0,
        overflowY: "scroll",
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 32,
        paddingBottom: 32,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 576, alignSelf: "center" }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="radio-tower" size={16} color={theme.mutedForeground} />
          <Text weight={500} color={theme.mutedForeground}>
            Local servers
          </Text>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderRadius: RADIUS.xl,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.7),
            backgroundColor: theme.background,
            overflow: "hidden",
          }}
        >
          {servers.map((server, index) => (
            <div
              key={`${server.host}:${server.port}`}
              testId={`preview-local-server-${server.port}`}
              onClick={() => onOpenUrl(server.requestedUrl)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 12,
                cursor: "pointer",
                borderTopWidth: index === 0 ? 0 : 1,
                borderColor: alpha(theme.border, 0.6),
                hover: { backgroundColor: alpha(theme.accent, 0.4) },
              }}
            >
              <Icon name="globe" size={16} color={theme.mutedForeground} />
              <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                <Text weight={500} truncate>
                  {server.processName ?? "Listening"}
                </Text>
                <Text size="xs" color={theme.mutedForeground} truncate>
                  {`${server.host}:${server.port}`}
                </Text>
              </div>
            </div>
          ))}
        </div>
        <Text size="xs" color={theme.mutedForeground} style={{ paddingLeft: 4, paddingRight: 4 }}>
          Select a live local server to open it in this browser tab.
        </Text>
      </div>
    </div>
  );
}
