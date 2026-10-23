// useOpenInPreferredEditor from apps/web/src/editorPreferences.ts, reduced to
// what "Open keybindings.json" needs. The last-used editor lives under the same
// key the web keeps in localStorage.
import { useAtomValue } from "@effect/atom-react";
import { EDITORS, EditorId, type EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { shellEnvironment, serverEnvironment } from "../../state/environment.ts";
import { useAtomCommand } from "../../state/settings.ts";
import { localStore } from "../../web/lib/localStore.ts";

const LAST_EDITOR_KEY = "t3code:last-editor";
const decodeEditorId = Schema.decodeUnknownOption(EditorId);

function readStoredEditor(): EditorId | null {
  const raw = localStore.getItem(LAST_EDITOR_KEY);
  if (raw === null) return null;
  try {
    const parsed = decodeEditorId(JSON.parse(raw));
    return parsed._tag === "Some" ? parsed.value : null;
  } catch {
    return null;
  }
}

function resolveAndPersistPreferredEditor(availableEditors: ReadonlyArray<EditorId>): EditorId | null {
  const available = new Set(availableEditors);
  const stored = readStoredEditor();
  if (stored && available.has(stored)) return stored;
  const editor = EDITORS.find((candidate) => available.has(candidate.id))?.id ?? null;
  if (editor) localStore.setItem(LAST_EDITOR_KEY, JSON.stringify(editor));
  return editor;
}

const EMPTY_CONFIG_ATOM = Atom.make(null);

/** Opens `path` on the environment's machine in the preferred editor; resolves to an error message or null. */
export function useOpenInPreferredEditor(environmentId: EnvironmentId | null) {
  const config = useAtomValue(environmentId === null ? EMPTY_CONFIG_ATOM : serverEnvironment.configValueAtom(environmentId));
  const availableEditors = config?.availableEditors ?? [];
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  return async (path: string) => {
    if (environmentId === null) return { ok: false as const, message: `Cannot open ${path} because no environment is selected.` };
    const editor = resolveAndPersistPreferredEditor(availableEditors);
    if (!editor) return { ok: false as const, message: `No available editor can open ${path}.` };
    const result = await openInEditor({ environmentId, input: { cwd: path, editor } });
    return { ok: true as const, result };
  };
}
