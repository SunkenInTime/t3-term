// Ports of apps/web/src/components/pullRequest/{PullRequestStackMenu,PullRequestStackPopover,
// PullRequestStackHeader,PullRequestStackLayers,PullRequestStackLayerContent}.tsx: a stacked pull
// request's layers, as the detail header's "▤ 2/3" menu (with "Merge stack" and "Rebase stack")
// and as the list row's popover.
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PullRequestMergeMethod,
  PullRequestRef,
  PullRequestStack,
  PullRequestStackMembership,
} from "@t3tools/contracts";
import type { EventPayload } from "@gpuix/native";
import { useState } from "react";

import { pullRequestEnvironment, usePullRequestStack } from "../state/pullRequests.ts";
import { Icon } from "../ui/Icon.tsx";
import { Dialog, Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { toast, updateToast } from "../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { PrButton } from "./prControls.tsx";
import { PrMenu, PrMenuGroupLabel, PrMenuItem, PrMenuSeparator } from "./PullRequestMenus.tsx";
import { PullRequestGlyph, resolvePullRequestState } from "./pullRequestPresentation.tsx";
import { runPullRequestWrite } from "./pullRequestWrites.ts";

// gpuix hands a click to every handler under the pointer, so a list row would also open when its
// stack button is pressed. The button marks the click; the row skips a marked one.
let consumedClick: { x: number; y: number; at: number } | null = null;
export function markRowControlClick(event: EventPayload) {
  consumedClick = { x: Number(event.x ?? 0), y: Number(event.y ?? 0), at: Date.now() };
}
export function wasStackClick(event: EventPayload): boolean {
  const consumed = consumedClick;
  return (
    consumed !== null &&
    consumed.x === Number(event.x ?? 0) &&
    consumed.y === Number(event.y ?? 0) &&
    Date.now() - consumed.at < 500
  );
}

export function PullRequestStackLayerContent({
  layer,
  compact = false,
}: {
  layer: PullRequestStack["layers"][number];
  compact?: boolean;
}) {
  const theme = useTheme();
  const state = resolvePullRequestState({ state: layer.state, isDraft: layer.isDraft ?? false });
  return (
    <>
      <Icon name={state.icon} size={16} color={state.tone(theme)} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <Text truncate>{layer.title || layer.headBranch}</Text>
        <Text size="xs" color={theme.mutedForeground} truncate>
          {`#${layer.number} · ${compact ? "" : `${layer.headBranch} · `}${state.label}`}
        </Text>
      </div>
    </>
  );
}

export function PullRequestStackHeader({
  number,
  notice,
  stale = false,
}: {
  number: number;
  notice?: string | null | undefined;
  stale?: boolean;
}) {
  const theme = useTheme();
  return (
    <PrMenuGroupLabel>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text size="xs" weight={500} color={theme.mutedForeground}>{`Stack #${number}`}</Text>
        {notice ? (
          <Tooltip content={notice}>
            <div style={{ display: "flex" }}>
              <Text size="xs" color={theme.mutedForeground}>
                {stale ? "May be stale" : "Refreshing…"}
              </Text>
            </div>
          </Tooltip>
        ) : null}
      </div>
    </PrMenuGroupLabel>
  );
}

export function PullRequestStackLayers({
  stack,
  reference,
  onSelect,
  pending = false,
}: {
  stack: PullRequestStack;
  reference: PullRequestRef;
  onSelect?: ((reference: PullRequestRef) => void) | undefined;
  pending?: boolean;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: 320, overflowY: "scroll" }}>
      {stack.layers.toReversed().map((layer) => (
        <PrMenuItem
          key={layer.number}
          disabled={!onSelect || pending}
          onSelect={() => onSelect?.({ ...reference, number: layer.number })}
          testId={`pr-stack-layer-${layer.number}`}
          iconNode={
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, minWidth: 0 }}>
              <PullRequestStackLayerContent layer={layer} />
              {layer.number === reference.number ? <Icon name="check" size={14} color={theme.foreground} /> : null}
            </div>
          }
        >
          {null}
        </PrMenuItem>
      ))}
      <PrMenuGroupLabel>{`↳ ${stack.base}`}</PrMenuGroupLabel>
    </div>
  );
}

export function PullRequestStackMenu({
  hostLabel,
  stack,
  reference,
  environmentId,
  canMerge,
  canRebase,
  mergeMethod,
  onSelect,
  onActed,
  notice,
  onRetry,
}: {
  hostLabel: string;
  notice?: string | null;
  onRetry?: (() => void) | undefined;
  stack: PullRequestStack;
  reference: PullRequestRef;
  environmentId: EnvironmentId;
  canMerge: boolean;
  canRebase: boolean;
  mergeMethod: PullRequestMergeMethod;
  onSelect?: ((reference: PullRequestRef) => void) | undefined;
  onActed: () => void;
}) {
  const theme = useTheme();
  const [confirmation, setConfirmation] = useState<"merge" | "update-branch" | null>(null);
  const [pending, setPending] = useState(false);
  const top = stack.layers.at(-1);
  const unmerged = stack.layers.filter((layer) => layer.state !== "merged");
  const hasClosed = unmerged.some((layer) => layer.state !== "open");
  const position = stack.layers.findIndex((layer) => layer.number === reference.number) + 1;
  const mergeLayers = stack.layers.slice(0, position).filter((layer) => layer.state !== "merged");
  const selectedLayer = stack.layers[position - 1];
  const mergeHasClosed = mergeLayers.some((layer) => layer.state !== "open");
  const hasUnknownHead = unmerged.some((layer) => !layer.headSha);
  const mergeDisabled =
    pending ||
    selectedLayer?.state !== "open" ||
    mergeLayers.some((layer) => !layer.headSha) ||
    mergeHasClosed ||
    mergeLayers.length === 0 ||
    mergeLayers.some((layer) => layer.isDraft);
  const rebaseDisabled = pending || hasUnknownHead || hasClosed || unmerged.length === 0;
  const run = async () => {
    if (pending || !confirmation || (confirmation === "merge" ? !canMerge || mergeDisabled : !canRebase || rebaseDisabled)) {
      return;
    }
    const action = confirmation;
    const target = action === "merge" ? selectedLayer : top;
    if (!target?.headSha) return;
    const actionHeads = (action === "merge" ? mergeLayers : unmerged).flatMap((layer) =>
      layer.headSha ? [{ number: layer.number, headSha: layer.headSha }] : [],
    );
    setPending(true);
    setConfirmation(null);
    const toastId = toast({ type: "loading", title: action === "merge" ? "Merging stack..." : "Rebasing stack..." });
    const result = await runPullRequestWrite(pullRequestEnvironment.runAction, {
      environmentId,
      input: {
        ...reference,
        number: target.number,
        stackNumber: stack.number,
        expectedStackHeads: actionHeads,
        action,
        ...(action === "merge" ? { mergeMethod } : { updateMethod: "rebase" as const }),
      },
    });
    setPending(false);
    onActed();
    if (result._tag === "Failure") {
      updateToast(toastId, {
        type: "error",
        title: action === "merge" ? "Could not merge the stack" : "Could not rebase the stack",
        description: String(squashAtomCommandFailure(result)),
      });
    } else {
      updateToast(toastId, {
        type: "success",
        title: action === "merge" ? "Stack merge request completed" : "Stack rebased",
        ...(action === "merge" ? { description: `${hostLabel} merged the stack or added it to its merge queue.` } : {}),
      });
    }
  };
  const confirmationLayers = confirmation === "merge" ? mergeLayers : unmerged;
  return (
    <>
      <PrMenu
        align="start"
        minWidth={280}
        testId="pr-stack-menu"
        trigger={({ toggle }) => (
          <Tooltip
            content={`View stack #${stack.number}, layer ${position} of ${stack.layers.length}${notice ? ` · ${notice}` : ""}`}
          >
            <div style={{ display: "flex" }}>
              <PrButton variant="ghost" icon={PullRequestGlyph.stack} onClick={toggle} testId="pr-stack">
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text size="xs" weight={500}>{`${position}/${stack.layers.length}`}</Text>
                  {onRetry ? <Icon name="triangle-alert" size={12} color={theme.warning} /> : null}
                </div>
              </PrButton>
            </div>
          </Tooltip>
        )}
      >
        <PullRequestStackHeader number={stack.number} notice={notice} stale={!!onRetry} />
        {onRetry ? <PrMenuItem onSelect={onRetry}>Retry stack refresh</PrMenuItem> : null}
        <PullRequestStackLayers stack={stack} reference={reference} pending={pending} onSelect={onSelect} />
        {canMerge || canRebase ? (
          <>
            <PrMenuSeparator />
            {canMerge ? (
              <PrMenuItem
                icon={PullRequestGlyph.merged}
                disabled={mergeDisabled}
                onSelect={() => setConfirmation("merge")}
                testId="pr-stack-merge-item"
              >
                {`Merge stack (${mergeLayers.length})`}
              </PrMenuItem>
            ) : null}
            {canRebase ? (
              <PrMenuItem
                icon="refresh-cw"
                disabled={rebaseDisabled}
                onSelect={() => setConfirmation("update-branch")}
                testId="pr-stack-rebase-item"
              >
                Rebase stack
              </PrMenuItem>
            ) : null}
            {mergeHasClosed || mergeLayers.some((layer) => layer.isDraft) ? (
              <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}>
                <Text size="xs" color={theme.mutedForeground}>
                  Every layer being merged must be open and ready for review.
                </Text>
              </div>
            ) : null}
          </>
        ) : null}
      </PrMenu>
      {canMerge && selectedLayer?.state === "open" ? (
        <Tooltip
          content={`Merge stack through #${reference.number} into ${stack.base} (${mergeLayers.length} ${mergeLayers.length === 1 ? "pull request" : "pull requests"})`}
          side="top"
        >
          <div style={{ display: "flex" }}>
            <PrButton
              variant="default"
              icon={PullRequestGlyph.merged}
              disabled={mergeDisabled}
              onClick={() => setConfirmation("merge")}
              testId="pr-stack-merge"
            >
              Merge stack
            </PrButton>
          </div>
        </Tooltip>
      ) : null}
      <Dialog
        open={confirmation !== null}
        onOpenChange={(value) => {
          if (!value) setConfirmation(null);
        }}
        width={448}
        testId="pr-stack-confirm"
        title={
          confirmation === "merge" ? `Merge ${mergeLayers.length} pull requests?` : `Rebase ${unmerged.length} pull requests?`
        }
        description={
          confirmation === "merge"
            ? `Merge #${reference.number} and its unmerged layers below into ${stack.base} using ${mergeMethod}. ${hostLabel} checks their rules before merging or queueing them and rebases the remaining stack after merging.`
            : `Rebase the remote branches from bottom to top onto ${stack.base}. This rewrites branch history and may restart checks. If a layer fails, earlier updates remain.`
        }
        footer={
          <>
            <PrButton size="sm" onClick={() => setConfirmation(null)} testId="pr-stack-confirm-cancel">
              Cancel
            </PrButton>
            <PrButton size="sm" variant="default" onClick={() => void run()} testId="pr-stack-confirm-run">
              {confirmation === "merge" ? "Merge stack" : "Rebase stack"}
            </PrButton>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 192, overflowY: "scroll" }}>
          {confirmationLayers.map((layer) => (
            <div
              key={layer.number}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 8,
                paddingBottom: 8,
                borderRadius: RADIUS.md,
                backgroundColor: alpha(theme.muted, 0.5),
                flexShrink: 0,
              }}
            >
              <PullRequestStackLayerContent layer={layer} compact />
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}

/** Mounted only while the popover is open, so list rows do not each fetch a stack. */
function StackBody({
  environmentId,
  reference,
  onSelect,
  stackNumber,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  onSelect: (reference: PullRequestRef) => void;
  stackNumber: number;
}) {
  const query = usePullRequestStack(environmentId, reference);
  if (query.data !== null) {
    return (
      <>
        <PullRequestStackHeader number={query.data.number} notice={query.notice} stale={!!query.error} />
        {query.error ? <PrMenuItem onSelect={query.refresh}>Retry stack refresh</PrMenuItem> : null}
        <PullRequestStackLayers stack={query.data} reference={reference} onSelect={onSelect} />
      </>
    );
  }
  return (
    <>
      <PullRequestStackHeader number={stackNumber} />
      <PrMenuGroupLabel>
        {query.error ?? (query.isPending ? "Loading stack…" : "This pull request is no longer in a stack.")}
      </PrMenuGroupLabel>
    </>
  );
}

export function PullRequestStackPopover({
  environmentId,
  reference,
  membership,
  onSelect,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  membership: PullRequestStackMembership;
  onSelect: (reference: PullRequestRef) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <PrMenu
      align="start"
      minWidth={280}
      onOpenChange={setOpen}
      testId={`pr-stack-popover-${reference.number}`}
      trigger={({ toggle }) => (
        <Tooltip content={`View stack #${membership.number}, layer ${membership.position} of ${membership.size}`}>
          <div
            testId={`pr-row-stack-${reference.number}`}
            onClick={(event) => {
              markRowControlClick(event);
              toggle();
            }}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0, cursor: "pointer" }}
          >
            <Icon name={PullRequestGlyph.stack} size={12} color={theme.mutedForeground} />
            <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>
              {`${membership.position}/${membership.size}`}
            </text>
          </div>
        </Tooltip>
      )}
    >
      {open ? (
        <StackBody
          environmentId={environmentId}
          reference={reference}
          stackNumber={membership.number}
          onSelect={(target) => {
            setOpen(false);
            onSelect(target);
          }}
        />
      ) : null}
    </PrMenu>
  );
}
