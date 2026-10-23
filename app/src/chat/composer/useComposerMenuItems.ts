// OWNER: composer agent (command menu sub-task). STUB: replace with the port of
// apps/web/src/components/chat/useComposerMenuItems.ts (path search through
// client-runtime, built-in and provider slash commands, skills).
import type {
  EnvironmentId,
  ProviderDriverKind,
  ServerProviderSkill,
  ServerProviderSlashCommand,
  ThreadId,
} from "@t3tools/contracts";

import type { ComposerTrigger } from "../../web/composer-logic.ts";
import type { ComposerCommandItem } from "../../web/components/chat/ComposerCommandMenu.ts";

export interface ComposerMenuItemsInput {
  readonly composerTrigger: ComposerTrigger | null;
  readonly environmentId: EnvironmentId;
  readonly gitCwd: string | null;
  readonly activeThreadId: ThreadId | null;
  readonly planModeUiEnabled: boolean;
  readonly compactSlashCommandAvailable: boolean;
  readonly selectedProvider: ProviderDriverKind;
  readonly selectedProviderSkills: ReadonlyArray<ServerProviderSkill>;
  readonly selectedProviderSlashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly showSkillsInSlashMenu: boolean;
}

export function useComposerMenuItems(_input: ComposerMenuItemsInput): {
  readonly items: ReadonlyArray<ComposerCommandItem>;
  readonly isLoading: boolean;
  readonly emptyState: string;
} {
  return { items: [], isLoading: false, emptyState: "No matches" };
}
