// Command palette UI state (web keeps it in CommandPalette's reducer and opens it
// through commandPaletteBus.ts). `commandPaletteOpenAtom` in ui.ts stays the open
// flag every area may set; this module adds mode and the open intent.
import { createFilesystemEnvironmentAtoms } from "@t3tools/client-runtime/state/filesystem";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { createSourceControlEnvironmentAtoms } from "@t3tools/client-runtime/state/source-control";
import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import {
  reduceCommandPaletteUiState,
  type CommandPaletteUiAction,
  type CommandPaletteUiState,
} from "../web/components/CommandPalette.logic.ts";
import type { CommandPaletteOpenDetail } from "../web/commandPaletteBus.ts";
import { commandPaletteModeRequestAtom } from "./sidebar.ts";
import { commandPaletteOpenAtom } from "./ui.ts";

type PaletteDetail = Omit<CommandPaletteUiState, "open">;

export const commandPaletteDetailAtom = Atom.make<PaletteDetail>({
  mode: "command",
  openIntent: null,
}).pipe(Atom.keepAlive);

export function readCommandPaletteState(): CommandPaletteUiState {
  return {
    ...appAtomRegistry.get(commandPaletteDetailAtom),
    open: appAtomRegistry.get(commandPaletteOpenAtom),
  };
}

export function dispatchCommandPalette(action: CommandPaletteUiAction): void {
  const { open, ...detail } = reduceCommandPaletteUiState(readCommandPaletteState(), action);
  appAtomRegistry.set(commandPaletteDetailAtom, detail);
  appAtomRegistry.set(commandPaletteOpenAtom, open);
}

/** commandPaletteBus.openCommandPalette: open plain, in a nested view, or with a query. */
export function openCommandPalette(detail?: CommandPaletteOpenDetail): void {
  if (detail?.open === "new-thread-in") {
    dispatchCommandPalette({ _tag: "OpenNewThreadIn" });
  } else if (detail?.open === "add-project") {
    dispatchCommandPalette({ _tag: "OpenAddProject" });
  } else if (detail?.query !== undefined) {
    dispatchCommandPalette({
      _tag: "OpenSearch",
      query: detail.query,
      ...(detail.linkedThreads ? { linkedThreads: detail.linkedThreads } : {}),
    });
  } else {
    dispatchCommandPalette({ _tag: "SetOpen", open: true });
  }
}

export function isCommandPaletteOpen(): boolean {
  return appAtomRegistry.get(commandPaletteOpenAtom);
}

// ── Queries the palette runs (web: state/filesystem.ts, orchestration.ts,
// sourceControl.ts, projects.ts projectContentSearch) ────────────────────

export const filesystemEnvironment = createFilesystemEnvironmentAtoms(connectionAtomRuntime);
export const orchestrationEnvironment = createOrchestrationEnvironmentAtoms(connectionAtomRuntime);
export const sourceControlEnvironment = createSourceControlEnvironmentAtoms(connectionAtomRuntime);
export const projectContentSearch = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:projects:search-contents",
  tag: WS_METHODS.projectsSearchContents,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});


/**
 * Settings rows the palette lists under "Settings" for a query (web:
 * searchSettings + useAvailableSettingsSearchItems). The settings area owns the
 * search index and registers it here; without a provider the group is absent.
 */
export interface PaletteSettingsResult {
  readonly id: string;
  readonly title: string;
  readonly sectionLabel: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly secondary?: boolean;
  readonly open: () => void;
}
export type PaletteSettingsSearchProvider = (query: string) => ReadonlyArray<PaletteSettingsResult>;
let settingsSearchProvider: PaletteSettingsSearchProvider | null = null;
export function registerPaletteSettingsSearch(provider: PaletteSettingsSearchProvider): () => void {
  settingsSearchProvider = provider;
  return () => {
    if (settingsSearchProvider === provider) settingsSearchProvider = null;
  };
}
export function searchPaletteSettings(query: string): ReadonlyArray<PaletteSettingsResult> {
  return settingsSearchProvider?.(query) ?? [];
}

// The sidebar asks for a palette view through its own request atom
// (state/sidebar.ts commandPaletteModeRequestAtom); apply each request once.
appAtomRegistry.subscribe(commandPaletteModeRequestAtom, (request) => {
  if (request === null) return;
  appAtomRegistry.set(commandPaletteModeRequestAtom, null);
  openCommandPalette({ open: request.open });
});
