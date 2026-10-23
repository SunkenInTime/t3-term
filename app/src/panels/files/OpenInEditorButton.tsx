// The Files subheader's editor launcher: chat/OpenInPicker.tsx with `compact`
// (an outline xs button group: the preferred editor's icon, then a chevron that
// opens the editor list). Shares the preferred editor with the details card's
// "Open in" row (state/git.ts preferredEditorPref).
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, EDITORS, type EditorId, type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { ActionMenu } from "../../chat/header/ActionMenu.tsx";
import { appAtomRegistry } from "../../runtime/runtime.ts";
import { serverEnvironment, shellEnvironment } from "../../state/environment.ts";
import { preferredEditorPref } from "../../state/git.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { toast } from "../../ui/toast.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { readEnvironmentScope, useEnvironmentScope } from "../../web/state/session.ts";

/** components/Icons.tsx CursorIcon (monochrome; dark fill #EDECEC, light #26251E). */
const CURSOR_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 466.73 532.09" fill="currentColor"><path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z"/></svg>';

function editorLabel(editorId: EditorId): string {
  if (editorId === "file-manager") {
    return process.platform === "darwin" ? "Finder" : process.platform === "win32" ? "File Explorer" : "Files";
  }
  return EDITORS.find((editor) => editor.id === editorId)?.label ?? "Editor";
}

function editorIcon(editorId: EditorId): IconName {
  if (editorId === "file-manager") return "folder";
  if (editorId === "zed") return "square-code";
  return "code";
}

function EditorGlyph({ editor, color }: { editor: EditorId | null; color: string }) {
  if (editor === "cursor") {
    return <svg source={CURSOR_ICON} style={{ width: 14, height: 14, flexShrink: 0, color, pointerEvents: "none" }} />;
  }
  return <Icon name={editor ? editorIcon(editor) : "square-arrow-out-up-right"} size={14} color={color} />;
}

export function OpenInEditorButton({ environmentId, absolutePath }: { environmentId: EnvironmentId; absolutePath: string }) {
  const theme = useTheme();
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const preferred = useAtomValue(preferredEditorPref.atom) as EditorId | "";
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const [open, setOpen] = useState(false);
  const available = config?.availableEditors ?? [];
  const effective: EditorId | null =
    preferred && available.includes(preferred) ? preferred : (EDITORS.find((editor) => available.includes(editor.id))?.id ?? null);
  const options = EDITORS.map((editor) => editor.id).filter((id) => available.includes(id));
  if (available.includes("file-manager") && !options.includes("file-manager")) options.push("file-manager");
  const disabled = !effective || !canOperate;
  const brandColor = theme.appearance === "dark" ? "#edecec" : "#26251e";

  const openIn = async (editor: EditorId | null) => {
    if (!editor || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    preferredEditorPref.set(editor);
    const result = (await runAtomCommand(
      appAtomRegistry,
      shellEnvironment.openInEditor,
      { environmentId, input: { cwd: absolutePath, editor } } as never,
      { reportFailure: false },
    )) as AtomCommandResult<unknown, unknown>;
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toast({ type: "error", title: "Unable to open in editor", description: error instanceof Error ? error.message : "An error occurred." });
    }
  };

  const part = (testId: string, onClick: (() => void) | undefined, children: React.ReactNode, side: "left" | "right") => (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 22,
        cursor: onClick ? "pointer" : "default",
        ...(side === "left"
          ? { borderTopLeftRadius: RADIUS.md - 1, borderBottomLeftRadius: RADIUS.md - 1 }
          : { borderTopRightRadius: RADIUS.md - 1, borderBottomRightRadius: RADIUS.md - 1 }),
        ...(onClick ? { hover: { backgroundColor: theme.accent } } : {}),
      }}
    >
      {children}
    </div>
  );

  return (
    <ActionMenu<string>
      open={open}
      onOpenChange={setOpen}
      align="end"
      minWidth={180}
      testId="files-open-in-menu"
      items={
        options.length === 0
          ? [{ id: "none", label: "No installed editors found", disabled: true }]
          : options.map((editor) => ({ id: editor, label: editorLabel(editor), icon: editorIcon(editor), ...(editor === effective ? { checked: true } : {}) }))
      }
      onSelect={(id) => {
        if (id !== "none") void openIn(id as EditorId);
      }}
      trigger={
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            height: 24,
            flexShrink: 0,
            borderWidth: 1,
            borderColor: alpha(theme.foreground, 0.12),
            borderRadius: RADIUS.md,
            backgroundColor: alpha(theme.foreground, 0.025),
            opacity: disabled ? 0.64 : 1,
          }}
        >
          <Tooltip content={effective ? `Open in ${editorLabel(effective)}` : "Open file in preferred editor"}>
            {part("files-open-in", disabled ? undefined : () => void openIn(effective), <EditorGlyph editor={effective} color={effective === "cursor" ? brandColor : theme.mutedForeground} />, "left")}
          </Tooltip>
          <div style={{ width: 1, height: 22, backgroundColor: alpha(theme.foreground, 0.08) }} />
          {part("files-open-in-choose", canOperate ? () => setOpen(!open) : undefined, <Icon name="chevron-down" size={16} color={theme.mutedForeground} />, "right")}
        </div>
      }
    />
  );
}
