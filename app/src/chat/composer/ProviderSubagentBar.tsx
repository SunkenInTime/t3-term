// Port of apps/web/src/components/chat/ProviderSubagentBar.tsx: a provider-native
// subagent thread can't take messages, so its composer is replaced by a bar with the
// model, the live status ("Working · 42s") and "Open parent".
//
// Web ticks the status by writing the DOM each second; here only the status label
// subscribes to the shared second tick, and only while the subagent is live.
import { useAtomValue } from "@effect/atom-react";
import {
  formatProviderSubagentStatus,
  type ProviderSubagentStatus,
} from "@t3tools/client-runtime/state/thread-execution";
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { nowSecondAtom } from "../../sidebar/clock.ts";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, useTheme } from "../../ui/theme.ts";
import type { ProviderInstanceEntry } from "../../web/providerInstances.ts";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon.tsx";

const STILL_ATOM = Atom.make(0);

/** `@max-[560px]/composer-surface`: the status drops under the model. */
const STACK_MAX_WIDTH = 560;
/** `@max-[640px]`: "Runs on its own" hides. */
const HINT_MAX_WIDTH = 640;
/** `@max-[320px]`: "Open parent" keeps only its icon. */
const ICON_ONLY_MAX_WIDTH = 320;

function SubagentStatusLabel({ status, stacked }: { status: ProviderSubagentStatus | null; stacked: boolean }) {
  const theme = useTheme();
  const live = status !== null && isOrchestrationV2WorkActive(status.status);
  const now = useAtomValue(live ? nowSecondAtom : STILL_ATOM);
  return (
    <text
      testId="provider-subagent-status"
      style={{
        color: theme.mutedForeground,
        fontSize: stacked ? 12 : 14,
        lineHeight: stacked ? 16 : 20,
        fontFamily: FONTS.sans,
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      {formatProviderSubagentStatus(status, live ? now : Date.now())}
    </text>
  );
}

export function ProviderSubagentBar(props: {
  readonly provider: ProviderInstanceEntry | null;
  readonly showInstanceBadge: boolean;
  readonly modelLabel: string;
  readonly effortLabel: string | null;
  readonly status: ProviderSubagentStatus | null;
  readonly onOpenParent: (() => void) | null;
  /** The composer surface width (web sizes this bar by the composer, not the viewport). */
  readonly width: number | null;
}) {
  const theme = useTheme();
  const width = props.width ?? Number.POSITIVE_INFINITY;
  const stacked = width <= STACK_MAX_WIDTH;
  return (
    <div
      testId="provider-subagent-bar"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 48,
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 20,
        paddingRight: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: stacked ? "column" : "row",
          alignItems: stacked ? "flex-start" : "center",
          gap: stacked ? 2 : 12,
          flexGrow: 1,
          flexBasis: 0,
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, maxWidth: "100%" }}>
          {props.provider ? (
            <ProviderInstanceIcon
              driverKind={props.provider.driverKind}
              displayName={props.provider.displayName}
              accentColor={props.provider.accentColor}
              showBadge={props.showInstanceBadge}
              compactBadge
              size={16}
            />
          ) : null}
          <Text weight={500} truncate>
            {props.modelLabel}
          </Text>
          {props.effortLabel === null ? null : (
            <Text color={theme.mutedForeground} style={{ flexShrink: 0 }}>
              {props.effortLabel}
            </Text>
          )}
        </div>
        <SubagentStatusLabel status={props.status} stacked={stacked} />
      </div>
      {width > HINT_MAX_WIDTH ? (
        <Text color={theme.mutedForeground} style={{ flexShrink: 0 }}>
          Runs on its own
        </Text>
      ) : null}
      {props.onOpenParent ? (
        <Button size="sm" variant="ghost" icon="arrow-up-left" onClick={props.onOpenParent} testId="provider-subagent-open-parent">
          {width > ICON_ONLY_MAX_WIDTH ? "Open parent" : undefined}
        </Button>
      ) : null}
    </div>
  );
}
