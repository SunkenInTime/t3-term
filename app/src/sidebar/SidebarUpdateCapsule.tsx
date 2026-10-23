// Port of apps/web/src/components/sidebar/SidebarUpdateCapsule.tsx: while an
// "update everything" run is going, the sidebar's update button widens into
// a capsule with the run's progress, and opens a popover listing each machine.
// The desktop app's own row ("This app", "Restart to update") is left out.
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState, type ReactNode } from "react";

import { environmentIdsKey } from "../state/settings.ts";
import { environmentUpdateStatesAtom } from "../state/updates.ts";
import { Popover } from "../ui/overlay.tsx";
import { Button } from "../ui/primitives.tsx";
import { FONTS, alpha, useTheme } from "../ui/theme.ts";
import {
  RUN_STATUS_LABELS,
  describeUpdateCapsule,
  formatUpdateElapsed,
  resolveUpdateRunMachineStatus,
  type UpdateEverythingRun,
  type UpdateRunLocalState,
  type UpdateRunMachineView,
} from "../web/components/sidebar/updateEverything.logic.ts";
import { useServerUpdate } from "./serverUpdates.ts";
import { dismissSettledUpdateRunMachines, retryFailedUpdateRunServers } from "./updateEverythingRun.ts";

/** Wall time rounded down to `intervalMs`, ticking only while an interval is set. */
function useNow(intervalMs: number | null): number {
  const step = intervalMs ?? 60_000;
  const read = () => Math.floor(Date.now() / step) * step;
  const [now, setNow] = useState(read);
  useEffect(() => {
    setNow(read());
    if (intervalMs === null) return;
    const timer = setInterval(() => setNow(read()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function useUpdateRunMachineViews(run: UpdateEverythingRun): ReadonlyArray<UpdateRunMachineView> {
  const updateStates = useAtomValue(
    environmentUpdateStatesAtom(environmentIdsKey(run.machines.map(({ environmentId }) => environmentId))),
  );
  return run.machines.map((machine, index) => ({
    machine,
    status: resolveUpdateRunMachineStatus(machine, run.phase, updateStates[index]!),
  }));
}

const textXs = { fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans } as const;

export function SidebarUpdateCapsule({
  run,
  local,
  icon,
}: {
  readonly run: UpdateEverythingRun;
  readonly local: UpdateRunLocalState;
  readonly icon: ReactNode;
}) {
  const theme = useTheme();
  const machines = useUpdateRunMachineViews(run);
  const hasActiveMachine = machines.some(
    ({ status }) => status !== "done" && status !== "failed" && status !== "waiting",
  );
  const now = useNow(run.phase === "countdown" ? 1_000 : hasActiveMachine ? 30_000 : null);
  const view = describeUpdateCapsule(run, machines, local, now);
  const updateServer = useServerUpdate();
  const failed = machines.some(({ status }) => status === "failed");
  const settled = !hasActiveMachine && run.localVersion === null;
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  const actionLabel = view.action === "later" ? "Later" : view.action === "retry" ? "Retry" : "Dismiss";
  const runAction = () => {
    // "later" postpones the desktop app's own restart countdown, which a
    // client that installs nothing locally never starts.
    if (view.action === "later") return;
    if (view.action === "retry") retryFailedUpdateRunServers(updateServer);
    else dismissSettledUpdateRunMachines();
  };

  const ringColor =
    view.tone === "slow" ? alpha(theme.warning, 0.4) : view.tone === "failed" ? alpha(theme.error, 0.4) : null;

  const capsule = (
    <div
      testId="sidebar-update-capsule"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: 32,
        flexGrow: 1,
        minWidth: 0,
        borderRadius: 9999,
        backgroundColor: hovered ? theme.sidebar.rowHover : theme.sidebar.accent,
        ...(ringColor ? { borderWidth: 1, borderColor: ringColor } : {}),
      }}
    >
      <div
        testId="sidebar-update-capsule-trigger"
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "stretch",
          flexGrow: 1,
          minWidth: 0,
          cursor: "pointer",
          // With a ring the 1px border would shift the label; web's ring is inset.
          paddingLeft: ringColor ? 11 : 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minWidth: 0, overflow: "hidden", pointerEvents: "none" }}>
          <text
            style={{
              ...textXs,
              color: view.tone === "failed" ? theme.error : theme.sidebar.foreground,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden",
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            {view.label}
          </text>
          {view.slow ? (
            <text style={{ ...textXs, color: theme.warning, whiteSpace: "nowrap", flexShrink: 0 }}>{` ${view.slow.elapsed}`}</text>
          ) : null}
        </div>
        {view.action === null ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              flexShrink: 0,
              pointerEvents: "none",
            }}
          >
            {icon}
          </div>
        ) : null}
      </div>
      {view.action !== null ? (
        <div
          testId="sidebar-update-capsule-action"
          onClick={runAction}
          style={{
            display: "flex",
            alignItems: "center",
            alignSelf: "stretch",
            flexShrink: 0,
            paddingLeft: 6,
            paddingRight: ringColor ? 11 : 12,
            cursor: "pointer",
          }}
        >
          <text
            style={{
              ...textXs,
              color: theme.sidebar.foreground,
              // Web tints only the underline on hover; gpuix draws it in the text color.
              textDecoration: "underline",
            }}
          >
            {actionLabel}
          </text>
        </div>
      ) : null}
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={capsule}
      side="top"
      align="end"
      testId="sidebar-update-capsule-popover"
      rootStyle={{ flexGrow: 1, minWidth: 0 }}
      // PopoverPopup padding="compact" width="sm": py-2 px-3, w-64.
      style={{ width: 256, paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {machines.map(({ machine, status }) => (
          <div key={machine.environmentId} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <text
                style={{
                  ...textXs,
                  color: theme.foreground,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  minWidth: 0,
                  flexShrink: 1,
                }}
              >
                {machine.label}
              </text>
              <text
                style={{
                  ...textXs,
                  color: status === "failed" ? theme.error : theme.mutedForeground,
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                {RUN_STATUS_LABELS[status] +
                  (status !== "done" && status !== "failed" && status !== "waiting"
                    ? ` ${formatUpdateElapsed(now - machine.startedAt)}`
                    : "")}
              </text>
            </div>
            {machine.failure !== null ? (
              <text style={{ ...textXs, color: theme.mutedForeground }}>{machine.failure}</text>
            ) : null}
          </div>
        ))}
        {settled && failed ? (
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
            {view.action === "retry" ? (
              <Button size="xs" variant="outline" testId="sidebar-update-retry" onClick={runAction}>
                Retry
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" testId="sidebar-update-dismiss" onClick={dismissSettledUpdateRunMachines}>
              Dismiss
            </Button>
          </div>
        ) : null}
      </div>
    </Popover>
  );
}
