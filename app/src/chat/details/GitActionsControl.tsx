// Port of apps/web/src/components/GitActionsControl.tsx in its panel display mode:
// the quick action split button (Commit / Commit & push / Push & create PR / Pull /
// Publish), its menu, live progress, the inline success line, "Changes +N −M",
// Initialize Git, the commit dialog and the default-branch confirmation.
// Labels and enablement come from the ported GitActionsControl.logic.ts.
import { useAtomValue } from "@effect/atom-react";
import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  type EnvironmentId,
  type GitRunStackedActionResult,
  type GitStackedAction,
  type VcsStatusResult,
} from "@t3tools/contracts";
import { FloatingLayer } from "@gpuix/react/floating";
import { DismissableLayer } from "@gpuix/react";
import { useEffect, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { threadEnvironment } from "../../state/environment.ts";
import { openDiffSurface, vcsActionManager, vcsEnvironment } from "../../state/git.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Dialog, Tooltip, surfaceStyle } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  buildMenuItems,
  formatGitActionElapsed,
  GIT_ACTION_SUCCESS_VISIBLE_MS,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  resolveFeatureBranchUnavailableReason,
  resolveGitActionProgressPresentation,
  resolveQuickAction,
  resolveThreadBranchUpdate,
  type DefaultBranchConfirmableAction,
  type GitActionIconName,
  type GitActionMenuItem,
  type GitQuickAction,
} from "../../web/components/GitActionsControl.logic.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";
import { readEnvironmentScope, useEnvironmentScope } from "../../web/state/session.ts";
import { DetailsIcon, DetailsLabel, DetailsRow, DetailsSplit } from "./detailsControls.tsx";
import { Checkbox, TextAreaField } from "./formControls.tsx";
import { PublishRepositoryDialog } from "./PublishRepositoryDialog.tsx";

const MENU_WIDTH = 262;

interface InlineSuccess {
  readonly title: string;
  readonly description: string | null;
  readonly scopeKey: string;
}

interface PendingDefaultBranchAction {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  commitMessage?: string;
  filePaths?: string[];
}

export function sourceControlIconName(status: VcsStatusResult | null | undefined): IconName {
  const definition = sourceControlClients.get(status?.sourceControlProvider?.kind);
  if (definition.icon === "github") return "github";
  if (definition.icon === "gitlab") return "gitlab";
  return "git-pull-request";
}

function actionIcon(icon: GitActionIconName, status: VcsStatusResult | null): IconName {
  if (icon === "commit") return "git-commit-horizontal";
  if (icon === "push") return "cloud-upload";
  return sourceControlIconName(status);
}

function quickActionIcon(quickAction: GitQuickAction, status: VcsStatusResult | null): IconName {
  if (quickAction.kind === "open_publish") return "cloud-upload";
  if (quickAction.kind === "run_pull") return "cloud-download";
  if (quickAction.kind === "run_action") {
    if (quickAction.action === "commit") return "git-commit-horizontal";
    if (quickAction.action === "push" || quickAction.action === "commit_push") return "cloud-upload";
    return sourceControlIconName(status);
  }
  if (quickAction.label === "Commit") return "git-commit-horizontal";
  if (quickAction.label === "Push") return "cloud-upload";
  return "info";
}

function menuDisabledReason(
  item: GitActionMenuItem,
  status: VcsStatusResult | null,
  isBusy: boolean,
  hasPrimaryRemote: boolean,
): string | null {
  if (!item.disabled) return null;
  if (isBusy) return "Git action in progress.";
  if (!status) return "Git status is unavailable.";
  const hasBranch = status.refName !== null;
  const hasChanges = status.hasWorkingTreeChanges;
  const isAhead = status.aheadCount > 0;
  const isBehind = status.behindCount > 0;
  const terminology = sourceControlClients.get(status.sourceControlProvider?.kind).changeRequest;
  if (item.id === "commit") {
    return hasChanges ? "Commit is currently unavailable." : "Worktree is clean. Make changes before committing.";
  }
  if (item.id === "push") {
    if (!hasBranch) return "Detached HEAD: check out a branch before pushing.";
    if (hasChanges) return "Commit or stash local changes before pushing.";
    if (isBehind) return "Branch is behind upstream. Pull/rebase before pushing.";
    if (!status.hasUpstream && !hasPrimaryRemote) return 'Add an "origin" remote before pushing.';
    if (!isAhead) return "No local commits to push.";
    return "Push is currently unavailable.";
  }
  if (!hasBranch) return `Detached HEAD: check out a branch before creating a ${terminology.singular}.`;
  if (!status.hasUpstream && !hasPrimaryRemote) return `Add an "origin" remote before creating a ${terminology.singular}.`;
  if ((status.aheadOfDefaultCount ?? status.aheadCount) <= 0) return `No local commits to include in a ${terminology.singular}.`;
  if (isBehind) return `Branch is behind upstream. Pull/rebase before creating a ${terminology.singular}.`;
  return `Create ${terminology.singular} is currently unavailable.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

/** Re-renders every second while an action runs: the elapsed counter web shows next to progress. */
function Elapsed({ startedAtMs }: { startedAtMs: number | null }) {
  const theme = useTheme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAtMs]);
  const label = formatGitActionElapsed(startedAtMs, now);
  if (!label) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", height: 32, paddingRight: 10, flexShrink: 0, alignSelf: "flex-start" }}>
      <text style={{ color: theme.mutedForeground, fontSize: 11, lineHeight: 16, fontFamily: FONTS.sans }}>{label}</text>
    </div>
  );
}

function TwoLine({ icon, iconColor, title, detail }: { icon: IconName; iconColor: string; title: string; detail: string | null }) {
  const theme = useTheme();
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", height: 18, flexShrink: 0 }}>
        <Icon name={icon} size={14} color={iconColor} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <DetailsLabel>{title}</DetailsLabel>
        {detail ? (
          <Tooltip content={detail}>
            <text
              style={{
                color: theme.mutedForeground,
                fontSize: 11,
                lineHeight: 16,
                paddingTop: 2,
                fontFamily: FONTS.sans,
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
                minWidth: 0,
              }}
            >
              {detail}
            </text>
          </Tooltip>
        ) : null}
      </div>
    </>
  );
}

export function GitActionsControl({
  environmentId,
  thread,
  gitCwd,
  compact,
}: {
  environmentId: EnvironmentId;
  thread: EnvironmentThreadShell;
  gitCwd: string;
  compact: boolean;
}) {
  const theme = useTheme();
  const scope = { environmentId, cwd: gitCwd };
  const scopeKey = `${environmentId}\u0000${gitCwd}`;
  const canWrite = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const statusQuery = useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd: gitCwd } }));
  const status = statusQuery.data;
  const actionState = useAtomValue(vcsActionManager.stateAtom(scope));
  const [menuOpen, setMenuOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [editingFiles, setEditingFiles] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [inlineSuccess, setInlineSuccess] = useState<InlineSuccess | null>(null);
  const [pendingDefault, setPendingDefault] = useState<PendingDefaultBranchAction | null>(null);

  useEffect(() => {
    if (!inlineSuccess) return;
    const id = setTimeout(() => setInlineSuccess(null), GIT_ACTION_SUCCESS_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [inlineSuccess]);

  const isRepo = status?.isRepo ?? true;
  const hasPrimaryRemote = status?.hasPrimaryRemote ?? false;
  const isDefaultRef = status?.isDefaultRef ?? false;
  const isBusy =
    actionState.isRunning &&
    (actionState.operation === "run_change_request" ||
      actionState.operation === "pull" ||
      actionState.operation === "publish_repository");
  const initPending = actionState.isRunning && actionState.operation === "init";
  const menuItems = buildMenuItems(status, isBusy, hasPrimaryRemote);
  const quickAction = resolveQuickAction(status, isBusy, isDefaultRef, hasPrimaryRemote);
  const quickDisabledReason = !canWrite
    ? "This connection cannot change source control."
    : quickAction.disabled
      ? (quickAction.hint ?? "This action is currently unavailable.")
      : null;
  const progress = resolveGitActionProgressPresentation(actionState);
  const visibleSuccess = inlineSuccess?.scopeKey === scopeKey ? inlineSuccess : null;
  const totals = status?.branchChanges ?? status?.workingTree;
  const allFiles = status?.workingTree.files ?? [];
  const selectedFiles = allFiles.filter((file) => !excluded.has(file.path));
  const allSelected = excluded.size === 0;
  const noneSelected = selectedFiles.length === 0;
  const terminology = sourceControlClients.get(status?.sourceControlProvider?.kind).changeRequest;
  const pendingCopy = pendingDefault
    ? resolveDefaultBranchActionDialogCopy({
        action: pendingDefault.action,
        branchName: pendingDefault.branchName,
        includesCommit: pendingDefault.includesCommit,
        terminology,
      })
    : null;
  const featureBranchUnavailable = pendingDefault
    ? resolveFeatureBranchUnavailableReason({
        branchName: pendingDefault.branchName,
        hasWorkingTreeChanges: status?.hasWorkingTreeChanges ?? true,
      })
    : null;

  const refreshStatus = () => {
    void runAtomCommand(appAtomRegistry, vcsEnvironment.refreshStatus, { environmentId, input: { cwd: gitCwd } } as never, {
      reportFailure: false,
    });
  };

  const syncThreadBranch = (result: GitRunStackedActionResult) => {
    const update = resolveThreadBranchUpdate(result);
    if (!update || thread.branch === update.branch) return;
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    void runAtomCommand(appAtomRegistry, threadEnvironment.updateMetadata, {
      environmentId,
      input: { threadId: thread.id, branch: update.branch, expectedBranch: thread.branch },
    } as never);
  };

  async function runGitAction(input: {
    action: GitStackedAction;
    commitMessage?: string;
    skipDefaultBranchPrompt?: boolean;
    featureBranch?: boolean;
    filePaths?: string[];
  }) {
    if (!readEnvironmentScope(environmentId, AuthSourceControlWriteScope)) return;
    if (input.featureBranch && !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    const actionIsDefault = input.featureBranch ? false : isDefaultRef;
    const canCommit = input.action === "commit" || input.action === "commit_push" || input.action === "commit_push_pr";
    const includesCommit =
      canCommit && (input.action === "commit" || !!status?.hasWorkingTreeChanges || !!input.featureBranch);
    if (!input.skipDefaultBranchPrompt && requiresDefaultBranchConfirmation(input.action, actionIsDefault) && status?.refName) {
      if (input.action === "commit") return;
      setPendingDefault({
        action: input.action as DefaultBranchConfirmableAction,
        branchName: status.refName,
        includesCommit,
        ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
        ...(input.filePaths ? { filePaths: input.filePaths } : {}),
      });
      return;
    }
    setInlineSuccess(null);
    const result = (await runAtomCommand(
      appAtomRegistry,
      vcsActionManager.runStackedAction(scope),
      {
        actionId: crypto.randomUUID(),
        action: input.action,
        ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
        ...(input.featureBranch ? { featureBranch: true } : {}),
        ...(input.filePaths ? { filePaths: input.filePaths } : {}),
        threadId: thread.id,
      },
      { reportFailure: false },
    )) as AtomCommandResult<GitRunStackedActionResult, unknown>;
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      toast({ type: "error", title: "Action failed", description: errorMessage(squashAtomCommandFailure(result)), duration: 0 });
      return;
    }
    statusQuery.refresh();
    syncThreadBranch(result.value);
    setInlineSuccess({ title: result.value.toast.title, description: result.value.toast.description ?? null, scopeKey });
  }

  const runPull = async () => {
    setInlineSuccess(null);
    const result = (await vcsActionManager.track(appAtomRegistry, scope, { operation: "pull", label: "Pulling latest changes..." }, () =>
      runAtomCommand(appAtomRegistry, vcsEnvironment.pull, { environmentId, input: { cwd: gitCwd } } as never, { reportFailure: false }),
    )) as AtomCommandResult<{ status: string; refName: string; upstreamRef?: string | null }, unknown>;
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      toast({ type: "error", title: "Pull failed", description: errorMessage(squashAtomCommandFailure(result)), duration: 0 });
      return;
    }
    statusQuery.refresh();
    const pulled = result.value.status === "pulled";
    setInlineSuccess({
      title: pulled ? "Pulled" : "Already up to date",
      description: pulled
        ? `Updated ${result.value.refName} from ${result.value.upstreamRef ?? "upstream"}`
        : `${result.value.refName} is already synchronized.`,
      scopeKey,
    });
  };

  const runQuickAction = () => {
    if (quickAction.kind === "open_publish") {
      setPublishOpen(true);
      return;
    }
    if (quickAction.kind === "run_pull") {
      void runPull();
      return;
    }
    if (quickAction.kind === "show_hint") {
      toast({ type: "info", title: quickAction.label, ...(quickAction.hint ? { description: quickAction.hint } : {}) });
      return;
    }
    if (quickAction.action) void runGitAction({ action: quickAction.action });
  };

  const openForMenuItem = (item: GitActionMenuItem) => {
    if (item.disabled) return;
    setMenuOpen(false);
    if (item.dialogAction === "push") {
      void runGitAction({ action: "push" });
      return;
    }
    if (item.dialogAction === "create_pr") {
      void runGitAction({ action: "create_pr" });
      return;
    }
    setExcluded(new Set());
    setEditingFiles(false);
    setCommitOpen(true);
  };

  const closeCommitDialog = () => {
    setCommitOpen(false);
    setCommitMessage("");
    setExcluded(new Set());
    setEditingFiles(false);
  };

  const runCommitDialog = (featureBranch: boolean) => {
    const message = commitMessage.trim();
    const filePaths = allSelected ? undefined : selectedFiles.map((file) => file.path);
    closeCommitDialog();
    void runGitAction({
      action: "commit",
      ...(message ? { commitMessage: message } : {}),
      ...(filePaths ? { filePaths } : {}),
      ...(featureBranch ? { featureBranch: true, skipDefaultBranchPrompt: true } : {}),
    });
  };

  const initializeGit = async () => {
    const result = await vcsActionManager.track(appAtomRegistry, scope, { operation: "init", label: "Initializing repository" }, () =>
      runAtomCommand(appAtomRegistry, vcsEnvironment.init, { environmentId, input: { cwd: gitCwd } } as never, { reportFailure: false }),
    );
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toast({ type: "error", title: "Git initialization failed", description: errorMessage(squashAtomCommandFailure(result)) });
      return;
    }
    statusQuery.refresh();
  };

  if (!isRepo) {
    return (
      <DetailsRow testId="git-init" onClick={() => void initializeGit()} disabled={!canWrite || initPending}>
        <DetailsIcon name="git-branch-plus" />
        <DetailsLabel>{initPending ? "Initializing..." : "Initialize Git"}</DetailsLabel>
      </DetailsRow>
    );
  }

  const canPublish = canWrite && status !== null && !hasPrimaryRemote;
  const showGroup = !(compact && !progress && !visibleSuccess);

  const menu = (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {menuItems.map((item) => {
        const reason = menuDisabledReason(item, status, isBusy, hasPrimaryRemote);
        const row = (
          <div
            key={item.id}
            testId={`git-menu-${item.id}`}
            onClick={item.disabled || !canWrite ? undefined : () => openForMenuItem(item)}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              minHeight: 28,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: RADIUS.sm,
              opacity: item.disabled || !canWrite ? 0.5 : 1,
              cursor: item.disabled || !canWrite ? "default" : "pointer",
              ...(item.disabled || !canWrite ? {} : { hover: { backgroundColor: theme.accent } }),
            }}
          >
            <Icon name={actionIcon(item.icon, status)} size={16} color={theme.mutedForeground} />
            <Text>{item.label}</Text>
          </div>
        );
        return reason ? (
          <Tooltip key={item.id} content={reason} side="left">
            {row}
          </Tooltip>
        ) : (
          row
        );
      })}
      {canPublish ? (
        <div
          testId="git-menu-publish"
          onClick={
            isBusy
              ? undefined
              : () => {
                  setMenuOpen(false);
                  setPublishOpen(true);
                }
          }
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minHeight: 28,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: RADIUS.sm,
            cursor: isBusy ? "default" : "pointer",
            opacity: isBusy ? 0.5 : 1,
            ...(isBusy ? {} : { hover: { backgroundColor: theme.accent } }),
          }}
        >
          <Icon name="cloud-upload" size={16} color={theme.mutedForeground} />
          <Text>Publish repository...</Text>
        </div>
      ) : null}
      {status?.refName === null ? (
        <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}>
          <Text size="xs" color={theme.warningForeground}>
            Detached HEAD: create and check out a branch to enable push and pull request actions.
          </Text>
        </div>
      ) : null}
      {status && status.refName !== null && !status.hasWorkingTreeChanges && status.behindCount > 0 && status.aheadCount === 0 ? (
        <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}>
          <Text size="xs" color={theme.warningForeground}>
            Behind upstream. Pull/rebase first.
          </Text>
        </div>
      ) : null}
      {statusQuery.error ? (
        <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}>
          <Text size="xs" color={theme.errorForeground}>
            {statusQuery.error}
          </Text>
        </div>
      ) : null}
    </div>
  );

  const primary = progress ? (
    <TwoLine icon="loader-circle" iconColor={theme.mutedForeground} title={progress.status} detail={progress.output} />
  ) : visibleSuccess ? (
    <TwoLine icon="check" iconColor={theme.successForeground} title={visibleSuccess.title} detail={visibleSuccess.description} />
  ) : (
    <>
      <DetailsIcon name={quickActionIcon(quickAction, status)} />
      <DetailsLabel>{quickAction.label}</DetailsLabel>
    </>
  );

  const group = (
    <div style={{ display: "flex", position: "relative", width: "100%", flexDirection: "column" }}>
      <DetailsSplit
        testId="git-quick-action"
        primary={quickDisabledReason && !progress && !visibleSuccess ? (
          <Tooltip content={quickDisabledReason}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, flexGrow: 1, minWidth: 0 }}>{primary}</div>
          </Tooltip>
        ) : (
          primary
        )}
        multiline={Boolean(progress?.output || visibleSuccess?.description)}
        busy={progress !== null}
        onPrimary={progress || visibleSuccess ? undefined : runQuickAction}
        primaryDisabled={!canWrite || isBusy || quickAction.disabled}
        menuOpen={menuOpen}
        onToggleMenu={() => {
          if (!menuOpen) refreshStatus();
          setMenuOpen(!menuOpen);
        }}
        secondaryDisabled={isBusy}
        {...(progress ? { secondary: <Elapsed startedAtMs={progress.startedAtMs} /> } : {})}
      />
      {menuOpen ? (
        <DismissableLayer onEscapeKeyDown={() => setMenuOpen(false)}>
          <FloatingLayer
            side="bottom"
            align="end"
            sideOffset={4}
            testId="git-actions-menu"
            onMouseDownOutside={() => setMenuOpen(false)}
            style={{ ...surfaceStyle(theme), display: "flex", flexDirection: "column", padding: 4, width: MENU_WIDTH }}
          >
            {menu}
          </FloatingLayer>
        </DismissableLayer>
      ) : null}
    </div>
  );

  return (
    <>
      {showGroup ? group : null}
      <DetailsRow testId="git-changes" onClick={() => openDiffSurface({ environmentId, threadId: thread.id })}>
        <DetailsIcon name="file-diff" />
        <DetailsLabel>Changes</DetailsLabel>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <text style={{ color: theme.diffAdd, fontSize: 11, lineHeight: 16, fontFamily: FONTS.mono }}>
            {`+${formatDiffCount(totals?.insertions ?? 0)}`}
          </text>
          <text style={{ color: theme.diffDel, fontSize: 11, lineHeight: 16, fontFamily: FONTS.mono }}>
            {`-${formatDiffCount(totals?.deletions ?? 0)}`}
          </text>
        </div>
      </DetailsRow>

      <Dialog
        open={commitOpen}
        onOpenChange={(open) => {
          if (!open) closeCommitDialog();
        }}
        title="Commit changes"
        description="Review and confirm your commit. Leave the message blank to auto-generate one."
        testId="commit-dialog"
        showCloseButton
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: 12,
              borderRadius: RADIUS.xl,
              backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.035) : "#fbfbfb",
              borderWidth: 1,
              borderColor: theme.appearance === "dark" ? alpha("#ffffff", 0.05) : alpha("#000000", 0.05),
            }}
          >
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text color={theme.mutedForeground}>Branch</Text>
              <Text weight={500} style={{ flexGrow: 1 }}>
                {status?.refName ?? "(detached HEAD)"}
              </Text>
              {isDefaultRef ? <Text color={theme.warningForeground}>Default branch</Text> : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {editingFiles && allFiles.length > 0 ? (
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && !noneSelected}
                      onChange={() => setExcluded(allSelected ? new Set(allFiles.map((file) => file.path)) : new Set())}
                      testId="commit-files-all"
                    />
                  ) : null}
                  <Text color={theme.mutedForeground}>Files</Text>
                  {!allSelected && !editingFiles ? (
                    <Text color={theme.mutedForeground}>{`(${selectedFiles.length} of ${allFiles.length})`}</Text>
                  ) : null}
                </div>
                {allFiles.length > 0 ? (
                  <Button variant="ghost" size="xs" testId="commit-edit-files" onClick={() => setEditingFiles(!editingFiles)}>
                    {editingFiles ? "Done" : "Edit"}
                  </Button>
                ) : null}
              </div>
              {!status || allFiles.length === 0 ? (
                <Text weight={500}>none</Text>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div
                    style={{
                      height: 176,
                      borderRadius: RADIUS.lg,
                      backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.025) : theme.card,
                      borderWidth: 1,
                      borderColor: theme.appearance === "dark" ? alpha("#ffffff", 0.05) : alpha("#000000", 0.05),
                      overflowY: "scroll",
                      scrollbarColor: theme.scrollbar,
                      pointerEvents: "auto",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 4 }}>
                      {allFiles.map((file) => {
                        const isExcluded = excluded.has(file.path);
                        return (
                          <div
                            key={file.path}
                            style={{
                              display: "flex",
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 8,
                              paddingLeft: 8,
                              paddingRight: 8,
                              paddingTop: 4,
                              paddingBottom: 4,
                              borderRadius: RADIUS.sm,
                              hover: { backgroundColor: alpha(theme.accent, 0.5) },
                            }}
                          >
                            {editingFiles ? (
                              <Checkbox
                                checked={!isExcluded}
                                testId={`commit-file-${file.path}`}
                                onChange={() =>
                                  setExcluded((current) => {
                                    const next = new Set(current);
                                    if (next.has(file.path)) next.delete(file.path);
                                    else next.add(file.path);
                                    return next;
                                  })
                                }
                              />
                            ) : null}
                            <text
                              style={{
                                color: isExcluded ? theme.mutedForeground : theme.foreground,
                                fontSize: 14,
                                lineHeight: 20,
                                fontFamily: FONTS.mono,
                                flexGrow: 1,
                                minWidth: 0,
                                whiteSpace: "nowrap",
                                textOverflow: "ellipsis-start",
                                overflow: "hidden",
                              }}
                            >
                              {file.path}
                            </text>
                            {isExcluded ? (
                              <Text color={theme.mutedForeground} mono>
                                Excluded
                              </Text>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "row", flexShrink: 0 }}>
                                <text style={{ color: theme.diffAdd, fontSize: 14, lineHeight: 20, fontFamily: FONTS.mono }}>
                                  {`+${formatDiffCount(file.insertions)}`}
                                </text>
                                <text style={{ color: theme.mutedForeground, fontSize: 14, lineHeight: 20, fontFamily: FONTS.mono }}> / </text>
                                <text style={{ color: theme.diffDel, fontSize: 14, lineHeight: 20, fontFamily: FONTS.mono }}>
                                  {`-${formatDiffCount(file.deletions)}`}
                                </text>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end" }}>
                    <text style={{ color: theme.diffAdd, fontSize: 14, lineHeight: 20, fontFamily: FONTS.mono }}>
                      {`+${formatDiffCount(selectedFiles.reduce((sum, file) => sum + file.insertions, 0))}`}
                    </text>
                    <text style={{ color: theme.mutedForeground, fontSize: 14, lineHeight: 20, fontFamily: FONTS.mono }}> / </text>
                    <text style={{ color: theme.diffDel, fontSize: 14, lineHeight: 20, fontFamily: FONTS.mono }}>
                      {`-${formatDiffCount(selectedFiles.reduce((sum, file) => sum + file.deletions, 0))}`}
                    </text>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Text weight={500}>Commit message (optional)</Text>
            <TextAreaField
              testId="commit-message"
              value={commitMessage}
              onChange={setCommitMessage}
              placeholder="Leave empty to auto-generate"
              minRows={3}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="outline" size="sm" testId="commit-cancel" onClick={closeCommitDialog}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              testId="commit-new-branch"
              disabled={!canWrite || !canOperate || noneSelected}
              onClick={() => runCommitDialog(true)}
            >
              Commit on new branch
            </Button>
            <Button size="sm" testId="commit-submit" disabled={!canWrite || noneSelected} onClick={() => runCommitDialog(false)}>
              Commit
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={pendingDefault !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDefault(null);
        }}
        title={pendingCopy?.title ?? "Run action on default branch?"}
        {...(pendingCopy?.description ? { description: pendingCopy.description } : {})}
        width={576}
        testId="default-branch-dialog"
        showCloseButton
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {featureBranchUnavailable ? (
            <Text size="xs" color={theme.mutedForeground}>
              {featureBranchUnavailable}
            </Text>
          ) : null}
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button variant="outline" size="sm" testId="default-branch-abort" onClick={() => setPendingDefault(null)}>
              Abort
            </Button>
            <div style={{ flexGrow: 1 }} />
            <Button
              variant="outline"
              size="sm"
              testId="default-branch-continue"
              disabled={!canWrite}
              onClick={() => {
                const pending = pendingDefault;
                setPendingDefault(null);
                if (pending)
                  void runGitAction({
                    action: pending.action,
                    ...(pending.commitMessage ? { commitMessage: pending.commitMessage } : {}),
                    ...(pending.filePaths ? { filePaths: pending.filePaths } : {}),
                    skipDefaultBranchPrompt: true,
                  });
              }}
            >
              {pendingCopy?.continueLabel ?? "Continue"}
            </Button>
            <Button
              size="sm"
              testId="default-branch-feature"
              disabled={!canWrite || !canOperate || featureBranchUnavailable !== null}
              onClick={() => {
                const pending = pendingDefault;
                setPendingDefault(null);
                if (pending)
                  void runGitAction({
                    action: pending.action,
                    ...(pending.commitMessage ? { commitMessage: pending.commitMessage } : {}),
                    ...(pending.filePaths ? { filePaths: pending.filePaths } : {}),
                    featureBranch: true,
                    skipDefaultBranchPrompt: true,
                  });
              }}
            >
              Check out feature branch & continue
            </Button>
          </div>
        </div>
      </Dialog>

      <PublishRepositoryDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        environmentId={environmentId}
        gitCwd={gitCwd}
        onPublished={() => statusQuery.refresh()}
      />
    </>
  );
}
