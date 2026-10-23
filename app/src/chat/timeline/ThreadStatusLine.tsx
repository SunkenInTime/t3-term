// apps/web/src/components/chat/ThreadStatusLine.tsx and the snoozed/settled
// lines useThreadLifecycle.tsx puts in the timeline footer.
import { useAtomValue } from "@effect/atom-react";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { isAtomCommandInterrupted, runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { environmentThreadShells, serverEnvironment, threadEnvironment } from "../../state/environment.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Text } from "../../ui/primitives.tsx";
import { useTheme } from "../../ui/theme.ts";
import { toast } from "../../ui/toast.tsx";
import { formatRelativeTimeLabel, formatRelativeTimeUntilLabel } from "../../web/timestampFormat.ts";
import { useNowEverySecond } from "./parts.tsx";

function StatusLine(props: { icon: IconName; label: string; actionLabel: string; actionDisabled: boolean; onAction: () => void }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, paddingLeft: 4, paddingRight: 4, paddingBottom: 8 }}>
      <Icon name={props.icon} size={14} color={theme.mutedForeground} />
      <Text size="xs" color={theme.mutedForeground} truncate>
        {props.label}
      </Text>
      <Text size="xs" color={theme.mutedForeground}>
        ·
      </Text>
      <div
        testId="thread-status-action"
        onClick={props.actionDisabled ? undefined : props.onAction}
        style={{ display: "flex", flexShrink: 0, cursor: props.actionDisabled ? "default" : "pointer", opacity: props.actionDisabled ? 0.64 : 1 }}
      >
        <Text size="xs" weight={500} color={theme.mutedForeground}>
          {props.actionLabel}
        </Text>
      </div>
    </div>
  );
}

export function ThreadStatusFooter({ threadRef }: { threadRef: ScopedThreadRef }) {
  const shell = useAtomValue(environmentThreadShells.threadShellAtom(threadRef));
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const [busy, setBusy] = useState(false);
  // The relative label ("3d left") reads the clock; a minute tick is enough but a second tick is cheap here.
  useNowEverySecond(shell?.snoozedUntil != null || shell?.settledOverride === "settled");
  if (!shell) return null;
  const supportsSnooze = config?.environment.capabilities.threadSnooze === true;
  const supportsSettlement = config?.environment.capabilities.threadSettlement === true;
  const snoozed = supportsSnooze && effectiveSnoozed(shell, { now: new Date().toISOString() });
  const settled = supportsSettlement && shell.settledOverride === "settled";
  const run = async (command: typeof threadEnvironment.unsnooze, title: string) => {
    setBusy(true);
    const result = await runAtomCommand(appAtomRegistry, command, {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, reason: "user" },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toast({ type: "error", title, description: error instanceof Error ? error.message : "An error occurred." });
    }
  };
  if (snoozed) {
    return (
      <StatusLine
        icon="alarm-clock"
        label={shell.snoozedUntil ? `Snoozed, ${formatRelativeTimeUntilLabel(shell.snoozedUntil)}` : "Snoozed"}
        actionLabel={busy ? "Waking..." : "Wake now"}
        actionDisabled={busy}
        onAction={() => void run(threadEnvironment.unsnooze, "Failed to wake thread")}
      />
    );
  }
  if (settled) {
    return (
      <StatusLine
        icon="circle-check"
        label={shell.settledAt ? `Settled ${formatRelativeTimeLabel(shell.settledAt)}` : "Settled"}
        actionLabel={busy ? "Un-settling..." : "Un-settle"}
        actionDisabled={busy}
        onAction={() => void run(threadEnvironment.unsettle, "Failed to un-settle thread")}
      />
    );
  }
  return null;
}
