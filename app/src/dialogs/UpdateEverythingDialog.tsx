// Port of apps/web/src/components/sidebar/UpdateEverythingDialog.tsx: the
// alert dialog that confirms "update everything". It lists what updates on
// each machine, how many running threads the server restarts interrupt, and
// which machines are skipped and why.
import { useAtomValue } from "@effect/atom-react";

import { runningThreadCountAtom } from "../state/updates.ts";
import { Button, Text } from "../ui/primitives.tsx";
import { FONTS, useTheme } from "../ui/theme.ts";
import { useSmallViewport } from "../ui/viewport.tsx";
import type { RestartingMachine, SkippedMachine } from "../web/components/sidebar/updateEverything.logic.ts";
import { DIALOG_WIDTH, DialogFooter, DialogShell, MultilineText } from "./dialogKit.tsx";

interface UpdateEverythingDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly summary: string;
  readonly lines: ReadonlyArray<string>;
  readonly restarts: ReadonlyArray<RestartingMachine>;
  readonly skipped: ReadonlyArray<SkippedMachine>;
  readonly onConfirm: () => void;
}

export function UpdateEverythingDialog({ open, onOpenChange, ...content }: UpdateEverythingDialogProps) {
  if (!open) return null;
  return (
    <DialogShell width={DIALOG_WIDTH.lg} testId="update-everything-dialog" showCloseButton={false} onOpenChange={onOpenChange}>
      <UpdateEverythingDialogContent {...content} onCancel={() => onOpenChange(false)} />
    </DialogShell>
  );
}

function UpdateEverythingDialogContent({
  summary,
  lines,
  restarts,
  skipped,
  onConfirm,
  onCancel,
}: Omit<UpdateEverythingDialogProps, "open" | "onOpenChange"> & { readonly onCancel: () => void }) {
  const theme = useTheme();
  const small = useSmallViewport();
  const stopped = useAtomValue(
    runningThreadCountAtom(
      restarts
        .filter((machine) => !machine.continuesThreads)
        .map((machine) => machine.environmentId)
        .join("\n"),
    ),
  );
  const continuing = useAtomValue(
    runningThreadCountAtom(
      restarts
        .filter((machine) => machine.continuesThreads)
        .map((machine) => machine.environmentId)
        .join("\n"),
    ),
  );
  const running = stopped + continuing;
  const threads = `${running} running ${running === 1 ? "thread" : "threads"}`;

  return (
    <>
      {/* AlertDialogHeader: p-6 (max-sm:pb-4), gap-2; the extra notes add pt-2. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingTop: 24,
          paddingLeft: 24,
          paddingRight: 24,
          paddingBottom: small ? 16 : 24,
        }}
      >
        <text style={{ color: theme.foreground, fontSize: 20, lineHeight: 20, fontWeight: 600, fontFamily: FONTS.sans }}>
          {`${summary}?`}
        </text>
        {lines.length > 0 ? <MultilineText color={theme.mutedForeground}>{lines.join("\n")}</MultilineText> : null}
        {running > 0 ? (
          <div style={{ paddingTop: 8 }}>
            <Text>
              {stopped === 0
                ? `${threads} will be interrupted and can resume after the restart.`
                : continuing === 0
                  ? `${threads} will be interrupted.`
                  : `${threads} will be interrupted. ${continuing} can resume after the restart.`}
            </Text>
          </div>
        ) : null}
        {skipped.length > 0 ? (
          <div style={{ paddingTop: 8 }}>
            <MultilineText color={theme.foreground}>
              {skipped.map((machine) => `Skips ${machine.label}: ${machine.reason}`).join("\n")}
            </MultilineText>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" testId="update-everything-cancel" onClick={onCancel}>
          Cancel
        </Button>
        <Button testId="update-everything-confirm" onClick={onConfirm}>
          Update
        </Button>
      </DialogFooter>
    </>
  );
}
