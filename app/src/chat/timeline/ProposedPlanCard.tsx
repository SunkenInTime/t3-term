// apps/web/src/components/chat/ProposedPlanCard.tsx: a 22px-radius card with a
// "Plan" badge, the plan title, an actions menu (copy, download, save to
// workspace), and the plan markdown collapsed to 416px when long.
import { isAtomCommandInterrupted, runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "@t3tools/shared/proposedPlanText";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { memo, useEffect, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { projectEnvironment } from "../../state/environment.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Dialog, Menu, MenuItem } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { toast } from "../../ui/toast.tsx";
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildProposedPlanMarkdownFilename,
  normalizePlanMarkdownForExport,
} from "../../web/proposedPlan.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";
import { copyTextToClipboard } from "./system.ts";

/** max-h-104 */
const COLLAPSED_HEIGHT = 416;
/** h-24 */
const FADE_HEIGHT = 96;

/** Web's downloadPlanAsTextFile hands a Blob to the browser; here the file lands in ~/Downloads. */
async function downloadPlanToDownloads(filename: string, contents: string): Promise<string> {
  const directory = join(homedir(), "Downloads");
  await mkdir(directory, { recursive: true });
  const path = join(directory, filename);
  await writeFile(path, contents, "utf8");
  return path;
}

/** Badge variant="secondary": 18 tall, 12px medium, radius 6. */
function PlanBadge() {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 18,
        minWidth: 18,
        paddingLeft: 4,
        paddingRight: 4,
        borderRadius: RADIUS.sm,
        backgroundColor: theme.secondary,
        flexShrink: 0,
      }}
    >
      <Text size="xs" weight={500} color={theme.foreground}>
        Plan
      </Text>
    </div>
  );
}

export const ProposedPlanCard = memo(function ProposedPlanCard({
  planMarkdown,
  environmentId,
  workspaceRoot,
}: {
  planMarkdown: string;
  environmentId: EnvironmentId;
  workspaceRoot: string | undefined;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [lastSavePath, setLastSavePath] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  const title = proposedPlanTitle(planMarkdown) ?? "Proposed plan";
  const lineCount = planMarkdown.split("\n").length;
  const canCollapse = planMarkdown.length > 900 || lineCount > 20;
  const displayedPlanMarkdown = stripDisplayedPlanMarkdown(planMarkdown);
  const isCollapsed = canCollapse && !expanded;
  const markdown = isCollapsed ? buildCollapsedProposedPlanPreviewMarkdown(planMarkdown, { maxLines: 10 }) : displayedPlanMarkdown;
  const downloadFilename = buildProposedPlanMarkdownFilename(planMarkdown);
  const saveContents = normalizePlanMarkdownForExport(planMarkdown);
  const cardColor = alpha(theme.card, 0.7);

  const handleCopy = () => {
    copyTextToClipboard(saveContents).then(
      () => setCopied(true),
      (error: unknown) =>
        toast({
          type: "error",
          title: "Could not copy plan",
          description: error instanceof Error ? error.message : "An error occurred while copying.",
        }),
    );
  };

  const handleDownload = () => {
    downloadPlanToDownloads(downloadFilename, saveContents).then(
      (path) => toast({ type: "success", title: "Plan downloaded", description: path }),
      (error: unknown) =>
        toast({
          type: "error",
          title: "Could not download plan",
          description: error instanceof Error ? error.message : "An error occurred while saving.",
        }),
    );
  };

  const openSaveDialog = () => {
    if (!workspaceRoot) {
      toast({
        type: "error",
        title: "Workspace path is unavailable",
        description: "This thread does not have a workspace path to save into.",
      });
      return;
    }
    setSaveDialogOpen(true);
  };

  const handleSaveToWorkspace = (savePath: string) => {
    const relativePath = savePath.trim();
    if (!workspaceRoot) return;
    if (!relativePath) {
      toast({ type: "warning", title: "Enter a workspace path" });
      return;
    }
    setLastSavePath(savePath);
    setSaving(true);
    void (async () => {
      const result = await runAtomCommand(appAtomRegistry, projectEnvironment.writeFile, {
        environmentId,
        input: { cwd: workspaceRoot, relativePath, contents: saveContents },
      });
      setSaving(false);
      if (result._tag === "Success") {
        setSaveDialogOpen(false);
        toast({ type: "success", title: "Plan saved to workspace", description: result.value.relativePath });
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toast({
          type: "error",
          title: "Could not save plan",
          description: error instanceof Error ? error.message : "An error occurred while saving.",
        });
      }
    })();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        padding: 20,
        borderRadius: RADIUS["3xl"],
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.8),
        backgroundColor: cardColor,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 }}>
          <PlanBadge />
          <Text size="sm" weight={500} truncate>
            {title}
          </Text>
        </div>
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          align="end"
          testId="plan-actions-menu"
          trigger={({ toggle }) => (
            <div
              testId="plan-actions"
              onClick={toggle}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                borderRadius: RADIUS.md,
                borderWidth: 1,
                borderColor: theme.input,
                backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.026) : theme.popover,
                cursor: "pointer",
                flexShrink: 0,
                hover: { backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.05) : theme.accent },
              }}
            >
              <Icon name="ellipsis" size={16} color={theme.mutedForeground} />
            </div>
          )}
        >
          <MenuItem onSelect={handleCopy} testId="plan-copy">
            {copied ? "Copied!" : "Copy to clipboard"}
          </MenuItem>
          <MenuItem onSelect={handleDownload} testId="plan-download">
            Download as markdown
          </MenuItem>
          <MenuItem onSelect={openSaveDialog} disabled={!workspaceRoot || saving} testId="plan-save">
            Save to workspace
          </MenuItem>
        </Menu>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 16, minWidth: 0 }}>
        <div style={{ position: "relative", minWidth: 0, ...(isCollapsed ? { maxHeight: COLLAPSED_HEIGHT, overflow: "hidden" } : {}) }}>
          <ChatMarkdown text={markdown} tone="assistant" />
          {isCollapsed ? (
            <>
              {/* bg-linear-to-t from-card/95 via-card/80 to-transparent; gpuix gradients have two
                  stops, so the fade is two halves meeting at the 80% midpoint. 0deg points up. */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: FADE_HEIGHT / 2,
                  height: FADE_HEIGHT / 2,
                  pointerEvents: "none",
                  background: {
                    type: "linear-gradient",
                    angle: 0,
                    stops: [
                      { color: alpha(theme.card, 0.8), position: 0 },
                      { color: alpha(theme.card, 0), position: 1 },
                    ],
                  },
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: FADE_HEIGHT / 2,
                  pointerEvents: "none",
                  background: {
                    type: "linear-gradient",
                    angle: 0,
                    stops: [
                      { color: alpha(theme.card, 0.95), position: 0 },
                      { color: alpha(theme.card, 0.8), position: 1 },
                    ],
                  },
                }}
              />
            </>
          ) : null}
        </div>
        {canCollapse ? (
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", marginTop: 16 }}>
            <Button size="sm" variant="outline" testId="plan-expand" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Collapse plan" : "Expand plan"}
            </Button>
          </div>
        ) : null}
      </div>
      {saveDialogOpen ? (
        <SavePlanToWorkspaceDialog
          initialPath={lastSavePath || downloadFilename}
          placeholder={downloadFilename}
          workspaceRoot={workspaceRoot}
          saving={saving}
          onCancel={() => setSaveDialogOpen(false)}
          onSave={handleSaveToWorkspace}
        />
      ) : null}
    </div>
  );
});

/** The form owns the path so a keystroke re-renders it, not the card. */
function SavePlanToWorkspaceDialog({
  initialPath,
  placeholder,
  workspaceRoot,
  saving,
  onCancel,
  onSave,
}: {
  initialPath: string;
  placeholder: string;
  workspaceRoot: string | undefined;
  saving: boolean;
  onCancel: () => void;
  onSave: (path: string) => void;
}) {
  const theme = useTheme();
  const [savePath, setSavePath] = useState(initialPath);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
      title="Save plan to workspace"
      description={`Enter a path relative to ${workspaceRoot ?? "the workspace"}.`}
      width={576}
      testId="plan-save-dialog"
      footer={
        <>
          <Button variant="outline" size="sm" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} testId="plan-save-confirm" onClick={() => onSave(savePath)}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Text size="xs" weight={500}>
          Workspace path
        </Text>
        <input
          testId="plan-save-path"
          value={savePath}
          placeholder={placeholder}
          readOnly={saving}
          autoFocus
          onChange={(event) => setSavePath(event.value ?? "")}
          onSubmit={() => onSave(savePath)}
          style={{
            width: "100%",
            height: 32,
            paddingLeft: 10,
            paddingRight: 10,
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: theme.appearance === "dark" ? alpha("#ffffff", 0.026) : theme.popover,
            color: theme.foreground,
            fontSize: 14,
            fontFamily: FONTS.sans,
          }}
        />
      </div>
    </Dialog>
  );
}
