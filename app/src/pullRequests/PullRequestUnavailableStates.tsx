// Ports of apps/web/src/components/pullRequest/{PullRequestActivityUnavailableState,
// PullRequestDiffUnavailableState}.tsx: what the Summary/Timeline and Code tabs show when the
// host's activity or diff read failed.
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type { SourceControlProviderKind } from "@t3tools/contracts";
import { useState } from "react";

import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { openExternalUrl } from "../usage/openExternal.ts";
import { describePullRequestDiffError } from "../web/components/pullRequest/pullRequestDiffError.ts";
import { PrButton } from "./prControls.tsx";

export function PullRequestActivityUnavailableState({
  error,
  onRetry,
  compact = false,
}: {
  error: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <div
      testId="pr-activity-unavailable"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        ...(compact ? { paddingTop: 12, paddingBottom: 12 } : { minHeight: 192, paddingLeft: 16, paddingRight: 16, paddingTop: 40, paddingBottom: 40 }),
      }}
    >
      <Text weight={500} style={{ textAlign: "center" }}>
        Could not load pull request activity
      </Text>
      <Text size="xs" color={theme.mutedForeground} style={{ textAlign: "center", maxWidth: 448 }}>
        {error}
      </Text>
      <PrButton size="sm" icon="refresh-cw" onClick={onRetry} testId="pr-activity-retry">
        Retry
      </PrButton>
    </div>
  );
}

export function PullRequestDiffUnavailableState({
  error,
  provider,
  url,
  onRetry,
}: {
  error: string;
  provider: SourceControlProviderKind;
  url: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const providerName = sourceControlClients.get(provider).label;
  const { title, description } = describePullRequestDiffError(error, providerName);
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <div
      testId="pr-diff-unavailable"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        flexGrow: 1,
        padding: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: alpha(theme.warning, 0.1),
        }}
      >
        <Icon name="triangle-alert" size={20} color={theme.warning} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, maxWidth: 384 }}>
        <Text weight={600} style={{ textAlign: "center" }}>
          {title}
        </Text>
        <Text color={theme.mutedForeground} style={{ textAlign: "center" }}>
          {description}
        </Text>
      </div>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
        <PrButton size="sm" variant="default" icon="refresh-cw" onClick={onRetry} testId="pr-diff-retry">
          Try again
        </PrButton>
        <PrButton size="sm" icon="external-link" onClick={() => openExternalUrl(url)} testId="pr-diff-open-host">
          {`Open on ${providerName}`}
        </PrButton>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 512 }}>
        <div onClick={() => setDetailsOpen(!detailsOpen)} style={{ display: "flex", cursor: "pointer" }}>
          <Text size="xs" color={theme.mutedForeground}>
            Technical details
          </Text>
        </div>
        {detailsOpen ? (
          <div
            style={{
              display: "flex",
              marginTop: 12,
              width: "100%",
              maxHeight: 160,
              overflowY: "scroll",
              padding: 12,
              borderRadius: RADIUS.lg,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: alpha(theme.muted, 0.4),
            }}
          >
            <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.mono }}>{error}</text>
          </div>
        ) : null}
      </div>
    </div>
  );
}
