// Port of apps/web/src/components/chat/useComposerMenuItems.ts: builds the @, / and $
// suggestion lists and runs the searches each trigger needs. The # pull-request trigger
// is not ported (it needs the pull-request list atoms); it yields no items.
import { useAtomValue } from "@effect/atom-react";
import { matchComposerThreadItems } from "@t3tools/client-runtime/composerThreadItems";
import {
  getProviderSkillsForSlashMenu,
  getProviderSlashCommandsForSlashMenu,
} from "@t3tools/client-runtime/providerSkills";
import type {
  EnvironmentId,
  ProviderDriverKind,
  ServerProviderSkill,
  ServerProviderSlashCommand,
  ThreadId,
} from "@t3tools/contracts";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import { Atom } from "effect/reactivity";

import { environmentThreadShells } from "../../state/environment.ts";
import { useComposerPathSearch } from "../../state/composerQueries.ts";
import type { ComposerTrigger } from "../../web/composer-logic.ts";
import type { ComposerCommandItem } from "../../web/components/chat/ComposerCommandMenu.ts";
import {
  searchSlashCommandItems,
  slashCommandItemsForPromptPosition,
} from "../../web/components/chat/composerSlashCommandSearch.ts";
import { basenameOfPath } from "../../web/pierre-icons.ts";
import { searchProviderSkills } from "../../web/providerSkillSearch.ts";

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

const EMPTY_THREAD_SHELLS = Atom.make([] as const).pipe(Atom.withLabel("composer:no-thread-shells"));

export function useComposerMenuItems({
  composerTrigger,
  environmentId,
  gitCwd,
  activeThreadId,
  planModeUiEnabled,
  compactSlashCommandAvailable,
  selectedProvider,
  selectedProviderSkills,
  selectedProviderSlashCommands,
  showSkillsInSlashMenu,
}: ComposerMenuItemsInput): {
  readonly items: ReadonlyArray<ComposerCommandItem>;
  readonly isLoading: boolean;
  readonly emptyState: string;
} {
  const composerTriggerKind = composerTrigger?.kind ?? null;
  const pathTriggerQuery = composerTrigger?.kind === "path" ? composerTrigger.query : "";
  const isPathTrigger = composerTriggerKind === "path";
  // Thread shells only matter while @ is open; reading them otherwise would
  // re-render the composer on every sidebar change.
  const environmentThreadShellList = useAtomValue(
    isPathTrigger ? environmentThreadShells.threadShellsAtom : EMPTY_THREAD_SHELLS,
  );
  const workspaceEntries = useComposerPathSearch({
    environmentId,
    cwd: isPathTrigger ? gitCwd : null,
    query: isPathTrigger ? pathTriggerQuery : null,
  });

  const items = ((): ComposerCommandItem[] => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "path") {
      return [
        ...matchComposerThreadItems({
          shells: environmentThreadShellList,
          environmentId,
          excludeThreadId: activeThreadId,
          query: composerTrigger.query,
        }),
        ...workspaceEntries.entries.map((entry) => ({
          id: `path:${entry.kind}:${entry.path}`,
          type: "path" as const,
          path: entry.path,
          pathKind: entry.kind,
          searchTarget: workspaceEntries.searchedTarget,
          label: basenameOfPath(entry.path),
          description: entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))),
        })),
      ];
    }
    if (composerTrigger.kind === "slash-command") {
      const builtInSlashCommandItems = [
        {
          id: "slash:model",
          type: "slash-command",
          command: "model",
          label: "/model",
          description: "Switch response model for this thread",
        },
        ...(planModeUiEnabled
          ? ([
              {
                id: "slash:plan",
                type: "slash-command",
                command: "plan",
                label: "/plan",
                description: "Switch this thread into plan mode",
              },
              {
                id: "slash:default",
                type: "slash-command",
                command: "default",
                label: "/default",
                description: "Switch this thread back to normal build mode",
              },
            ] as const)
          : []),
      ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
      const slashMenuSkills = getProviderSkillsForSlashMenu(
        selectedProviderSkills,
        showSkillsInSlashMenu,
      );
      const providerSlashCommandItems = getProviderSlashCommandsForSlashMenu(
        selectedProviderSlashCommands,
        slashMenuSkills,
      ).map((command) => ({
        id: `provider-slash-command:${selectedProvider}:${command.name}`,
        type: "provider-slash-command" as const,
        provider: selectedProvider,
        command,
        label: `/${command.name}`,
        description: command.description ?? command.input?.hint ?? "Run provider command",
      }));
      const query = composerTrigger.query.trim().toLowerCase();
      const skillItems = slashMenuSkills.map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: `/skill:${skill.name}`,
        description:
          skill.shortDescription ?? skill.description ?? (skill.scope ? `${skill.scope} skill` : ""),
      }));
      const visibleProviderSlashCommandItems = providerSlashCommandItems.filter(
        (item) => item.command.name !== "compact" || compactSlashCommandAvailable,
      );
      const slashCommandItems = slashCommandItemsForPromptPosition(
        [...builtInSlashCommandItems, ...visibleProviderSlashCommandItems, ...skillItems],
        composerTrigger.rangeStart === 0,
      );
      return searchSlashCommandItems(slashCommandItems, query);
    }
    if (composerTrigger.kind === "skill") {
      return searchProviderSkills(selectedProviderSkills, composerTrigger.query).map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: formatProviderSkillDisplayName(skill),
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
      }));
    }
    return [];
  })();
  const isLoading =
    composerTriggerKind === "path" && pathTriggerQuery.length > 0 && workspaceEntries.isPending;
  const emptyState = (() => {
    if (composerTriggerKind === "skill") {
      return "No skills found. Try / to browse provider commands.";
    }
    if (composerTriggerKind === "pull-request") {
      return "Pull requests are not available for this project.";
    }
    return composerTriggerKind === "path" ? "No matching files or folders." : "No matching command.";
  })();

  return { items, isLoading, emptyState };
}
