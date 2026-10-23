// The keybindings half of web routes/__root.tsx EventRouter
// (handleServerConfigUpdated), plus components/KeybindingsConfigWarning.tsx.
// Web reads keybindings.json edits off the primary server's config stream:
// a clean reload toasts success (at most every 2s), a broken file warns with
// a button that opens it in the preferred editor.
import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type EditorId, type EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { primaryServerConfigAtom, primaryServerConfigEventAtom, resolvePreferredEditor } from "../state/coordinators.ts";
import { shellEnvironment } from "../state/environment.ts";
import { preferredEditorPref } from "../state/git.ts";
import { readEnvironmentScope, useEnvironmentScope } from "../state/settings.ts";
import { Button, Text } from "../ui/primitives.tsx";
import { useTheme } from "../ui/theme.ts";
import { toast } from "../ui/toast.tsx";
import {
  createKeybindingsUpdateToastController,
  type KeybindingsUpdateToastController,
} from "../web/components/KeybindingsUpdateToast.logic.ts";

export function KeybindingsToastCoordinator() {
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const serverConfigEvent = useAtomValue(primaryServerConfigEventAtom);
  // web: the event current at mount is history, not news.
  const handledConfigEventRef = useRef(serverConfigEvent);
  const [controller] = useState<KeybindingsUpdateToastController>(() => createKeybindingsUpdateToastController({}));

  useEffect(() => {
    if (serverConfigEvent === null || handledConfigEventRef.current === serverConfigEvent) return;
    handledConfigEventRef.current = serverConfigEvent;
    const decision = controller.handle(serverConfigEvent);
    if (!decision) return;
    if (decision._tag === "Success") {
      toast({
        type: "success",
        title: "Keybindings updated",
        description: "Keybindings configuration reloaded successfully.",
      });
      return;
    }
    toast({
      type: "warning",
      title: "Invalid keybindings configuration",
      actionLayout: "stacked-end",
      description: (
        <KeybindingsConfigWarning
          message={decision.message}
          environmentId={serverConfig?.environment.environmentId ?? null}
          configPath={serverConfig?.keybindingsConfigPath ?? null}
          availableEditors={serverConfig?.availableEditors ?? []}
        />
      ),
    });
  }, [serverConfigEvent]);

  return null;
}

function KeybindingsConfigWarning({
  message,
  environmentId,
  configPath,
  availableEditors,
}: {
  message: string;
  environmentId: EnvironmentId | null;
  configPath: string | null;
  availableEditors: readonly EditorId[];
}) {
  const theme = useTheme();
  const canOpenEditor = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const disabled = !canOpenEditor || !configPath || availableEditors.length === 0;

  const open = async () => {
    if (!configPath || environmentId === null) return;
    const failure = (description: string) =>
      toast({ type: "error", title: "Unable to open keybindings file", description, actionLayout: "stacked-end" });
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      failure("This connection cannot open an editor on this environment.");
      return;
    }
    const editor = resolvePreferredEditor(appAtomRegistry.get(preferredEditorPref.atom), availableEditors);
    if (!editor) {
      failure(`No available editor can open ${configPath} in environment ${environmentId}.`);
      return;
    }
    preferredEditorPref.set(editor);
    const result = await runAtomCommand(
      appAtomRegistry,
      shellEnvironment.openInEditor,
      { environmentId, input: { cwd: configPath, editor } },
      { reportFailure: false },
    );
    if (result._tag === "Success") return;
    const error = squashAtomCommandFailure(result);
    failure(error instanceof Error ? error.message : "Unknown error opening file.");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <Text color={theme.mutedForeground}>{message}</Text>
      {/* web: span.mt-2.flex.justify-end */}
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", marginTop: 8 }}>
        <Button size="xs" variant="outline" disabled={disabled} testId="keybindings-open-config" onClick={() => void open()}>
          Open keybindings.json
        </Button>
      </div>
    </div>
  );
}
