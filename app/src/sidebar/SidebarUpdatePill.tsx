// Port of apps/web/src/components/sidebar/SidebarUpdatePill.tsx as the web app
// renders it outside Electron: no desktop update state, so the control exists
// only while some connected server or provider can be updated ("update
// everything") or a run is going. The button opens UpdateEverythingDialog;
// during a run it becomes SidebarUpdateCapsule. The desktop parts (check /
// download / install of the app itself, the arm64 warning, nightly release
// notes) do not apply to t3-term.
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState } from "react";

import { UpdateEverythingDialog } from "../dialogs/UpdateEverythingDialog.tsx";
import { useEnvironments } from "../state/settings.ts";
import { DEV_FAKE_UPDATE_RUN } from "../state/updates.ts";
import { Icon } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { alpha, useTheme, type Palette } from "../ui/theme.ts";
import { toast } from "../ui/toast.tsx";
import { SidebarUpdateCapsule } from "./SidebarUpdateCapsule.tsx";
import { seedDevUpdateRun, useUpdateEverythingRun } from "./updateEverythingRun.ts";
import { useUpdateEverything } from "./useUpdateEverything.ts";

export function SidebarUpdatePill() {
  const theme = useTheme();
  const [isActionPending, setIsActionPending] = useState(false);
  const [isConfirmingEverything, setIsConfirmingEverything] = useState(false);
  const [hovered, setHovered] = useState(false);
  const everything = useUpdateEverything();
  const runsEverything = everything.hasUpdates;
  const run = useUpdateEverythingRun();
  const isRunningEverything = run !== null;
  const isInteractionDisabled = isActionPending || isRunningEverything;
  useDevFakeUpdateRun();

  const handleAction = () => {
    if (isInteractionDisabled || !runsEverything) return;
    setIsConfirmingEverything(true);
  };

  const runEverything = async () => {
    setIsConfirmingEverything(false);
    setIsActionPending(true);
    const result = await settlePromise(() => everything.run());
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toast({
        type: "error",
        title: "Could not update everything",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
    setIsActionPending(false);
  };

  if (!runsEverything && !isRunningEverything) return null;

  // DesktopUpdateStatusIcon status="everything".
  const statusIcon = <Icon name="circle-arrow-up" size={16} color={theme.sidebar.foreground} />;
  const confirmDialog = (
    <UpdateEverythingDialog
      open={isConfirmingEverything}
      onOpenChange={setIsConfirmingEverything}
      summary={everything.summary}
      lines={everything.lines}
      restarts={everything.restarts}
      skipped={everything.skipped}
      onConfirm={() => void runEverything()}
    />
  );

  if (run !== null) {
    return (
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minWidth: 0 }}>
        <SidebarUpdateCapsule run={run} local={null} icon={statusIcon} />
        {confirmDialog}
      </div>
    );
  }

  return (
    <>
      {/* SidebarMenuItem "ml-auto shrink-0" */}
      <div style={{ flexGrow: 1, minWidth: 0 }} />
      <Tooltip content={runsEverything ? everything.summary : "Update available"} side="top">
        <div
          testId="sidebar-update-pill"
          onClick={handleAction}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: 9999,
            cursor: isInteractionDisabled ? "not-allowed" : "pointer",
            backgroundColor: hovered && !isInteractionDisabled ? theme.sidebar.rowHover : sidebarControlSurface(theme),
          }}
        >
          {statusIcon}
        </div>
      </Tooltip>
      {confirmDialog}
    </>
  );
}

/** T3TERM_FAKE_UPDATE_RUN: seed a run once the connected machines are known. */
function useDevFakeUpdateRun() {
  const { environments } = useEnvironments();
  const seeded = useRef(false);
  const connected = environments.filter((environment) => environment.connection.phase === "connected");
  useEffect(() => {
    if (DEV_FAKE_UPDATE_RUN === null || seeded.current || connected.length === 0) return;
    seeded.current = true;
    seedDevUpdateRun(DEV_FAKE_UPDATE_RUN, connected);
  }, [connected.length]);
}

/**
 * bg-sidebar-control-surface. The default dark theme sets it to --muted, white
 * at 3% (measured on the web pill: #0a0a0a over the sidebar), which is dimmer
 * than the palette's sidebar accent; built-in themes and light mode carry it
 * as the sidebar accent.
 */
export function sidebarControlSurface(theme: Palette): string {
  return theme.themeId === null && theme.appearance === "dark" ? alpha("#ffffff", 0.03) : theme.sidebar.accent;
}
