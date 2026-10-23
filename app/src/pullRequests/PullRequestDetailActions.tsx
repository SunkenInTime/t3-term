// Port of apps/web/src/components/pullRequest/{PullRequestDetailActions,PullRequestActionsMenu}.tsx:
// the header's one prominent control (merge, ready for review, auto-merge), the checkout menu,
// "Resolve conflicts", "Approve workflows to run", and the overflow menu with everything else.
// Every write here goes through `perform`, which the detail view routes to `runPullRequestWrite`.
import type {
  EnvironmentId,
  PullRequestAction,
  PullRequestDetail,
  PullRequestMergeMethod,
  PullRequestUpdateMethod,
} from "@t3tools/contracts";
import type { ReactNode } from "react";

import { Icon, type IconName } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { useTheme } from "../ui/theme.ts";
import { openExternalUrl } from "../usage/openExternal.ts";
import {
  PULL_REQUEST_MERGE_METHOD_LABELS,
  pullRequestActionMenuHasGroup,
} from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import type { resolvePullRequestPrimaryControl } from "../web/components/pullRequest/pullRequestDetail.logic.ts";
import { PrButton, PrBadge, prButtonForeground } from "./prControls.tsx";
import { PrMenu, PrMenuItem, PrMenuSeparator } from "./PullRequestMenus.tsx";
import { PullRequestGlyph, type PullRequestStatePresentation } from "./pullRequestPresentation.tsx";
import { useInlineActionConfirm } from "./useInlineActionConfirm.tsx";

export type PerformPullRequestAction = (
  action: PullRequestAction,
  method?: PullRequestMergeMethod,
  updateMethod?: PullRequestUpdateMethod,
) => Promise<boolean>;

export interface PickableEnvironmentOption {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

/** A label that keeps the width of its longest wording, so a confirming press lands on it. */
export function HeldLabel({ shown, widest, color }: { shown: string; widest: ReadonlyArray<string>; color: string }) {
  return (
    <div style={{ display: "flex", position: "relative", flexShrink: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", height: 16, overflow: "hidden" }}>
        {[...new Set([...widest, shown])].map((label) => (
          <text key={label} style={{ color: "#00000000", fontSize: 12, lineHeight: 16, fontWeight: 500, whiteSpace: "nowrap" }}>
            {label}
          </text>
        ))}
      </div>
      <div style={{ display: "flex", position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "none" }}>
        <Text size="xs" weight={500} color={color} style={{ whiteSpace: "nowrap" }}>
          {shown}
        </Text>
      </div>
    </div>
  );
}

export function PullRequestResolveConflictsButton({
  handoff,
  unavailable,
  onResolve,
}: {
  handoff: string | null;
  unavailable: boolean;
  onResolve: () => void;
}) {
  const label = handoff === "conflicts" ? "Preparing..." : "Resolve conflicts";
  return (
    <Tooltip content={label} side="top">
      <div style={{ display: "flex" }}>
        <PrButton
          variant="destructive-outline"
          icon={PullRequestGlyph.conflicting}
          disabled={handoff !== null || unavailable}
          onClick={onResolve}
          testId="pr-resolve-conflicts"
        >
          {label}
        </PrButton>
      </div>
    </Tooltip>
  );
}

/** The header's one prominent control, which depends on where the pull request stands. */
export function PullRequestPrimaryAction({
  pullRequestKey,
  primaryAction,
  autoMergeArmed,
  armedAutoMergeLabel,
  pendingAutoMergeLabel,
  selectedMergeMethod,
  selectedMergeMethodLabel,
  statePresentation,
  pendingAction,
  perform,
  resolveConflicts,
}: {
  pullRequestKey: string;
  primaryAction: ReturnType<typeof resolvePullRequestPrimaryControl> | null;
  autoMergeArmed: boolean;
  armedAutoMergeLabel: string;
  pendingAutoMergeLabel: string;
  selectedMergeMethod: PullRequestMergeMethod;
  selectedMergeMethodLabel: string;
  statePresentation: PullRequestStatePresentation | null;
  pendingAction: PullRequestAction | null;
  perform: PerformPullRequestAction;
  resolveConflicts: ReactNode;
}) {
  const theme = useTheme();
  const inlineConfirm = useInlineActionConfirm(pullRequestKey);
  const actionPending = pendingAction !== null;
  const fg = prButtonForeground(theme, "default");
  const armedBadge = (
    <Tooltip content={`${armedAutoMergeLabel}: the host will merge this on its own once its requirements are met`} side="top">
      <div style={{ display: "flex" }}>
        <PrBadge variant="info" icon={PullRequestGlyph.merged} testId="pr-auto-merge-armed">
          {armedAutoMergeLabel}
        </PrBadge>
      </div>
    </Tooltip>
  );
  const confirmButton = (action: "merge" | "enable-auto-merge", idle: string, pendingLabel: string, confirm: string) => {
    const armed = inlineConfirm.isArmed(action, "header");
    const shown = pendingAction === action ? pendingLabel : armed ? confirm : idle;
    return (
      <Tooltip content={shown} side="top">
        <div style={{ display: "flex" }}>
          <PrButton
            variant="default"
            disabled={actionPending}
            icon={armed ? "check" : PullRequestGlyph.merged}
            testId={action === "merge" ? "pr-merge" : "pr-enable-auto-merge"}
            {...inlineConfirm.props(action, () => void perform(action, selectedMergeMethod), "header")}
          >
            <HeldLabel shown={shown} widest={[idle]} color={fg} />
          </PrButton>
        </div>
      </Tooltip>
    );
  };
  return (
    <>
      {inlineConfirm.escapeLayer}
      {autoMergeArmed && primaryAction !== "auto-merge-armed" ? armedBadge : null}
      {primaryAction === "resolve" ? (
        resolveConflicts
      ) : primaryAction === "ready" ? (
        <Tooltip content="Ready for review" side="top">
          <div style={{ display: "flex" }}>
            <PrButton
              variant="default"
              icon={PullRequestGlyph.pullRequest}
              disabled={actionPending}
              onClick={() => void perform("ready")}
              testId="pr-ready"
            >
              Ready for review
            </PrButton>
          </div>
        </Tooltip>
      ) : primaryAction === "enable-auto-merge" ? (
        confirmButton("enable-auto-merge", pendingAutoMergeLabel, "Enabling...", "Confirm auto-merge?")
      ) : primaryAction === "auto-merge-armed" ? (
        armedBadge
      ) : primaryAction === "merge" ? (
        confirmButton("merge", selectedMergeMethodLabel, "Merging...", "Confirm merge?")
      ) : (primaryAction === "merged" || primaryAction === "closed") && statePresentation !== null ? (
        <PrBadge variant="outline" icon={statePresentation.icon} color={statePresentation.tone(theme)}>
          {statePresentation.label}
        </PrBadge>
      ) : null}
    </>
  );
}

export function PullRequestApproveWorkflowsButton({
  pullRequestKey,
  pendingAction,
  perform,
}: {
  pullRequestKey: string;
  pendingAction: PullRequestAction | null;
  perform: PerformPullRequestAction;
}) {
  const theme = useTheme();
  const inlineConfirm = useInlineActionConfirm(pullRequestKey);
  const armed = inlineConfirm.isArmed("approve-workflows");
  const shown =
    pendingAction === "approve-workflows" ? "Approving..." : armed ? "Confirm approve?" : "Approve workflows to run";
  return (
    <div style={{ display: "flex", flexGrow: 1, justifyContent: "flex-end" }}>
      {inlineConfirm.escapeLayer}
      <Tooltip content={shown} side="top">
        <div style={{ display: "flex" }}>
          <PrButton
            variant="warning-outline"
            icon="play"
            disabled={pendingAction !== null}
            testId="pr-approve-workflows"
            {...inlineConfirm.props("approve-workflows", () => void perform("approve-workflows"))}
          >
            <HeldLabel
              shown={shown}
              widest={["Approve workflows to run", "Confirm approve?"]}
              color={prButtonForeground(theme, "warning-outline")}
            />
          </PrButton>
        </div>
      </Tooltip>
    </div>
  );
}

function ActOnEnvironmentPicker({
  environments,
  value,
  onChange,
  disabled,
}: {
  environments: ReadonlyArray<PickableEnvironmentOption>;
  value: EnvironmentId;
  onChange: (environmentId: EnvironmentId) => void;
  disabled: boolean;
}) {
  return (
    <>
      <PrMenuSeparator />
      {environments.map((environment) => (
        <PrMenuItem
          key={environment.environmentId}
          icon="monitor"
          checked={environment.environmentId === value}
          disabled={disabled}
          keepOpen
          onSelect={() => onChange(environment.environmentId)}
        >
          {environment.label}
        </PrMenuItem>
      ))}
    </>
  );
}

export function PullRequestCheckoutMenu({
  handoff,
  checkoutRoot,
  canPrepareWorktree,
  canCheckoutHere,
  onCheckout,
  pickableEnvironments,
  actingEnvironmentId,
  onActingEnvironmentChange,
  compact,
}: {
  handoff: string | null;
  checkoutRoot: string | null;
  canPrepareWorktree: boolean;
  canCheckoutHere: boolean;
  onCheckout: (mode: "worktree" | "local") => void;
  pickableEnvironments: ReadonlyArray<PickableEnvironmentOption>;
  actingEnvironmentId: EnvironmentId;
  onActingEnvironmentChange: (environmentId: EnvironmentId) => void;
  /** Web hides the label under a 35rem-wide header. */
  compact?: boolean;
}) {
  const theme = useTheme();
  const checkingOut = handoff?.startsWith("checkout") === true;
  const disabled = handoff !== null || checkoutRoot === null;
  return (
    <PrMenu
      align="end"
      minWidth={260}
      testId="pr-checkout-menu"
      trigger={({ toggle }) => (
        <Tooltip content="Check out this pull request">
          <div style={{ display: "flex" }}>
            <PrButton
              disabled={disabled}
              onClick={toggle}
              testId="pr-checkout"
              icon="git-branch"
              style={{ gap: 2, paddingLeft: 5, paddingRight: 5 }}
            >
              <>
                {compact ? null : (
                  <Text size="xs" weight={500} style={{ marginLeft: 2, marginRight: 2 }}>
                    {checkingOut ? "Checking out..." : "Check out"}
                  </Text>
                )}
                <Icon name="chevron-down" size={14} color={theme.mutedForeground} />
              </>
            </PrButton>
          </div>
        </Tooltip>
      )}
    >
      <PrMenuItem
        icon="git-branch"
        disabled={!canPrepareWorktree}
        description="Its own folder and thread. Nothing you have open moves."
        onSelect={() => onCheckout("worktree")}
        testId="pr-checkout-worktree"
      >
        In a separate worktree
      </PrMenuItem>
      <PrMenuItem
        icon="folder-git-2"
        disabled={!canCheckoutHere}
        description="Switches the branch you are working in, like `gh pr checkout`."
        onSelect={() => onCheckout("local")}
        testId="pr-checkout-local"
      >
        In this repository
      </PrMenuItem>
      {pickableEnvironments.length > 0 ? (
        <ActOnEnvironmentPicker
          environments={pickableEnvironments}
          value={actingEnvironmentId}
          onChange={onActingEnvironmentChange}
          disabled={handoff !== null}
        />
      ) : null}
    </PrMenu>
  );
}

/** Everything else the reader can do with the pull request, behind the header's overflow button. */
export function PullRequestActionsMenu({
  pullRequestKey,
  detail,
  number,
  threadLinkItem,
  refreshing,
  refreshFromHost,
  handoff,
  attachesToComposer,
  askAboutPullRequest,
  explainPullRequest,
  canFixFindings,
  startFixFindings,
  fixFindingsLabel,
  canWriteGuide,
  guideRunning,
  guideWritten,
  writeGuide,
  pickableEnvironments,
  actingEnvironmentId,
  onActingEnvironmentChange,
  can,
  autoMergeArmed,
  showsDraftToggle,
  showsMergeNow,
  showsAutoMerge,
  showsMergeMethods,
  allowedMergeMethods,
  selectedMergeMethod,
  onSelectMergeMethod,
  showsDeleteBranch,
  environmentConnected,
  confirmDeleteBranch,
  pendingAction,
  perform,
  openOnHostText,
  copyReference,
  copyLinkShortcut,
  copyNumberShortcut,
}: {
  pullRequestKey: string;
  detail: Pick<PullRequestDetail, "url" | "state" | "isDraft" | "headBranch">;
  number: number;
  threadLinkItem: ReactNode;
  refreshing: boolean;
  refreshFromHost: () => void;
  handoff: string | null;
  attachesToComposer: boolean;
  askAboutPullRequest: () => void;
  explainPullRequest: () => void;
  canFixFindings: boolean;
  startFixFindings: () => void;
  fixFindingsLabel: string;
  canWriteGuide: boolean;
  guideRunning: boolean;
  guideWritten: boolean;
  writeGuide: () => void;
  pickableEnvironments: ReadonlyArray<PickableEnvironmentOption>;
  actingEnvironmentId: EnvironmentId;
  onActingEnvironmentChange: (environmentId: EnvironmentId) => void;
  can: (action: PullRequestAction) => boolean;
  autoMergeArmed: boolean;
  showsDraftToggle: boolean;
  showsMergeNow: boolean;
  showsAutoMerge: boolean;
  showsMergeMethods: boolean;
  allowedMergeMethods: ReadonlyArray<PullRequestMergeMethod>;
  selectedMergeMethod: PullRequestMergeMethod;
  onSelectMergeMethod: (method: PullRequestMergeMethod) => void;
  showsDeleteBranch: boolean;
  environmentConnected: boolean;
  confirmDeleteBranch: () => void;
  pendingAction: PullRequestAction | null;
  perform: PerformPullRequestAction;
  openOnHostText: string;
  copyReference: (value: string, label: string) => void;
  copyLinkShortcut: string | null;
  copyNumberShortcut: string | null;
}) {
  const inlineConfirm = useInlineActionConfirm(pullRequestKey);
  const actionPending = pendingAction !== null;
  const confirmItem = (
    action: "merge" | "enable-auto-merge" | "close" | "revert",
    idle: string,
    confirm: string,
    icon: IconName,
    run: () => void,
    tone: "default" | "destructive" | "destructive-when-armed",
  ) => {
    const armed = inlineConfirm.isArmed(action, "menu");
    const { onClick, onMouseDownOutside } = inlineConfirm.props(action, run, "menu");
    return (
      <PrMenuItem
        icon={icon}
        destructive={tone === "destructive" || (tone === "destructive-when-armed" && armed)}
        disabled={actionPending}
        keepOpen={!armed}
        onSelect={onClick}
        onMouseDownOutside={onMouseDownOutside}
        testId={`pr-menu-${action}`}
      >
        {armed ? confirm : idle}
      </PrMenuItem>
    );
  };
  return (
    <PrMenu
      align="end"
      minWidth={200}
      testId="pr-actions-menu"
      trigger={({ toggle }) => (
        <Tooltip content={refreshing ? "Refreshing pull request" : "More pull request actions"}>
          <div style={{ display: "flex" }}>
            <IconButton
              icon={refreshing ? "refresh-cw" : "ellipsis"}
              size={24}
              iconSize={16}
              onClick={toggle}
              testId="pr-actions"
            />
          </div>
        </Tooltip>
      )}
    >
      {inlineConfirm.escapeLayer}
      {threadLinkItem}
      <PrMenuItem icon="refresh-cw" disabled={refreshing} onSelect={refreshFromHost} testId="pr-menu-refresh">
        Refresh
      </PrMenuItem>
      <PrMenuItem
        icon="message-circle-question"
        disabled={handoff !== null}
        onSelect={askAboutPullRequest}
        description={
          attachesToComposer
            ? "Adds the pull request to this thread's composer."
            : "Opens a thread that knows which pull request you mean."
        }
        testId="pr-menu-ask"
      >
        {handoff === "ask" ? "Opening..." : "Ask a question"}
      </PrMenuItem>
      <PrMenuItem
        icon="book-open"
        disabled={handoff !== null}
        onSelect={explainPullRequest}
        description="A walk through the diff and what to read closely."
        testId="pr-menu-explain"
      >
        {handoff === "explain" ? "Opening..." : "Explain this PR"}
      </PrMenuItem>
      <PrMenuItem
        icon="hammer"
        disabled={handoff !== null || !canFixFindings}
        onSelect={startFixFindings}
        testId="pr-menu-fix-findings"
      >
        {handoff === "findings" ? "Preparing..." : fixFindingsLabel}
      </PrMenuItem>
      {canWriteGuide ? (
        <PrMenuItem icon="sparkles" disabled={guideRunning} onSelect={writeGuide} testId="pr-menu-write-guide">
          {guideRunning ? "Writing guide..." : !guideWritten ? "Write guide" : "Rewrite guide"}
        </PrMenuItem>
      ) : null}
      {pickableEnvironments.length > 0 ? (
        <ActOnEnvironmentPicker
          environments={pickableEnvironments}
          value={actingEnvironmentId}
          onChange={onActingEnvironmentChange}
          disabled={handoff !== null}
        />
      ) : null}
      <PrMenuSeparator />
      {detail.state === "open" ? (
        <>
          {showsDraftToggle ? (
            <PrMenuItem
              icon={detail.isDraft ? PullRequestGlyph.pullRequest : PullRequestGlyph.draft}
              disabled={actionPending}
              onSelect={() => void perform(detail.isDraft ? "ready" : "draft")}
              testId="pr-menu-draft-toggle"
            >
              {detail.isDraft ? "Ready for review" : "Convert to draft"}
            </PrMenuItem>
          ) : null}
          {showsMergeNow
            ? confirmItem("merge", "Merge now", "Confirm merge?", PullRequestGlyph.merged, () => void perform("merge", selectedMergeMethod), "default")
            : null}
          {autoMergeArmed && can("disable-auto-merge") ? (
            <PrMenuItem
              icon={PullRequestGlyph.merged}
              disabled={actionPending}
              onSelect={() => void perform("disable-auto-merge")}
              testId="pr-menu-disable-auto-merge"
            >
              Disable auto-merge
            </PrMenuItem>
          ) : showsAutoMerge ? (
            confirmItem(
              "enable-auto-merge",
              "Enable auto-merge",
              "Confirm auto-merge?",
              PullRequestGlyph.merged,
              () => void perform("enable-auto-merge", selectedMergeMethod),
              "default",
            )
          ) : null}
          {showsMergeMethods ? (
            <>
              {showsDraftToggle || showsMergeNow || showsAutoMerge ? <PrMenuSeparator /> : null}
              {allowedMergeMethods.map((method) => (
                <PrMenuItem
                  key={method}
                  icon={PullRequestGlyph.merged}
                  checked={method === selectedMergeMethod}
                  disabled={actionPending}
                  onSelect={() => onSelectMergeMethod(method)}
                  testId={`pr-menu-method-${method}`}
                >
                  {PULL_REQUEST_MERGE_METHOD_LABELS[method]}
                </PrMenuItem>
              ))}
            </>
          ) : null}
          {pullRequestActionMenuHasGroup(showsDraftToggle, showsAutoMerge || showsMergeNow, showsMergeMethods) ? (
            <PrMenuSeparator />
          ) : null}
        </>
      ) : null}
      <PrMenuItem icon="arrow-up-right" onSelect={() => openExternalUrl(detail.url)} testId="pr-menu-open">
        {openOnHostText}
      </PrMenuItem>
      <PrMenuItem
        icon="link"
        shortcut={copyLinkShortcut}
        onSelect={() => copyReference(detail.url, "PR link")}
        testId="pr-menu-copy-link"
      >
        Copy link
      </PrMenuItem>
      <PrMenuItem
        icon="copy"
        shortcut={copyNumberShortcut}
        onSelect={() => copyReference(`#${number}`, "PR number")}
        testId="pr-menu-copy-number"
      >
        Copy PR number
      </PrMenuItem>
      {detail.state === "open" && can("close") ? (
        <>
          <PrMenuSeparator />
          {confirmItem("close", "Close pull request", "Confirm close?", PullRequestGlyph.closed, () => void perform("close"), "destructive")}
        </>
      ) : detail.state === "closed" && can("reopen") ? (
        <>
          <PrMenuSeparator />
          <PrMenuItem
            icon={PullRequestGlyph.reopen}
            disabled={actionPending}
            onSelect={() => void perform("reopen")}
            testId="pr-menu-reopen"
          >
            Reopen pull request
          </PrMenuItem>
        </>
      ) : detail.state === "merged" && can("revert") ? (
        <>
          <PrMenuSeparator />
          {confirmItem("revert", "Revert changes", "Confirm revert?", "rotate-ccw", () => void perform("revert"), "destructive-when-armed")}
        </>
      ) : null}
      {showsDeleteBranch ? (
        <>
          <PrMenuSeparator />
          <PrMenuItem
            icon="trash-2"
            destructive
            disabled={actionPending || !environmentConnected}
            onSelect={confirmDeleteBranch}
            description={environmentConnected ? detail.headBranch : "Reconnect to delete this branch"}
            testId="pr-menu-delete-branch"
          >
            {pendingAction === "delete-branch" ? "Deleting branch..." : "Delete branch"}
          </PrMenuItem>
        </>
      ) : null}
    </PrMenu>
  );
}
