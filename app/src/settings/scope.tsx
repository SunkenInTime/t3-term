// Settings scope ("Applying settings for [project] across [environment]") and
// scoped settings reads/writes. Ports apps/web/src/components/settings/
// {SettingsScopeContext.tsx, useScopedSettings.ts, useSettingsProjectGroups.ts}.
// The web app keeps the scope in the /settings search params; t3-term keeps it
// in settingsScopeSearchAtom so it survives page switches the same way.
import { useAtom, useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentAuthorizationError,
  requiredScopesForServerSettingsPatch,
  T3_PROJECT_FILE_NAME,
  type EnvironmentId,
  type ProjectScopedServerSettingKey,
  type ServerSettings,
  type T3ProjectFile,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { createContext, useContext, type ReactNode } from "react";

import {
  clientSettingsAtom,
  persistClientSettingsPatch,
  useClientSettings,
} from "../state/clientSettings.ts";
import { serverEnvironment } from "../state/environment.ts";
import {
  mergeEnvironmentSettings,
  readEnvironmentScope,
  useAtomCommand,
  useEnvironments,
  useEnvironmentsWithScope,
  usePrimaryEnvironmentId,
  useProjects,
} from "../state/settings.ts";
import { toast } from "../ui/toast.tsx";
import { buildSidebarProjectSnapshots } from "../web/sidebarProjectGrouping.ts";
import { getProjectFileQueryAtom, optimisticFileAtom } from "../web/components/files/projectFilesQueryState.ts";
import {
  persistScopedSettingsPatch,
  planProjectOverridesClear,
  planScopedSettingsClear,
  planScopedSettingsPatch,
  resolveScopedSettingsTargets,
  scopedSettingsAreMixed,
  scopedSettingsSource,
  selectScopedSettingsEnvironments,
  type ProjectOverrideEntry,
  type ScopedSettingsPatch,
} from "../web/components/settings/scopedSettings.ts";
import { resolveSettingsScope, type SettingsScopeSearch } from "../web/components/settings/settingsScope.ts";
import { selectSingleEnvironmentScope } from "../web/components/settings/settingsScopeAxis.ts";

export const settingsScopeSearchAtom = Atom.make<SettingsScopeSearch>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("t3term-settings-scope-search"),
);

export function useSettingsProjectGroups() {
  const projects = useProjects();
  const settings = useAtomValue(clientSettingsAtom);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const labels = new Map(environments.map((entry) => [entry.environmentId, entry.label]));
  return buildSidebarProjectSnapshots({
    projects,
    settings: {
      sidebarProjectGroupingMode: settings.sidebarProjectGroupingMode,
      sidebarProjectGroupingOverrides: settings.sidebarProjectGroupingOverrides,
    },
    primaryEnvironmentId,
    resolveEnvironmentLabel: (id) => labels.get(id) ?? null,
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

type ProjectFileMember = readonly [environmentId: EnvironmentId, workspaceRoot: string, physicalProjectKey: string];

// web SettingsScopeContext memberProjectFilesAtom: each member checkout's t3.json,
// the file tier between server defaults and project overrides. Keyed by the
// members' identifying fields so each render reads the same atom. An unsaved
// edit (the optimistic file) counts, so the settings follow the editor.
const memberProjectFilesAtom = Atom.family((membersKey: string) => {
  const members = JSON.parse(membersKey) as ReadonlyArray<ProjectFileMember>;
  return Atom.make((get) => {
    const files = new Map<string, T3ProjectFile | null>();
    for (const [environmentId, workspaceRoot, physicalProjectKey] of members) {
      const result = get(getProjectFileQueryAtom(environmentId, workspaceRoot, T3_PROJECT_FILE_NAME));
      if (result.waiting) continue;
      const data =
        get(optimisticFileAtom(environmentId, workspaceRoot, T3_PROJECT_FILE_NAME))?.data ??
        Option.getOrNull(AsyncResult.value(result));
      files.set(
        physicalProjectKey,
        data === null || data.exists === false || data.truncated ? null : parseT3ProjectFile(data.contents),
      );
    }
    return files;
  }).pipe(Atom.withLabel(`t3term-settings-member-project-files:${membersKey}`));
});

function useMemberProjectFiles(scope: ReturnType<typeof resolveSettingsScope>) {
  const members = scope.kind === "project" || scope.kind === "checkout" ? scope.members : [];
  return useAtomValue(
    memberProjectFilesAtom(
      JSON.stringify(
        members.map((member): ProjectFileMember => [member.environmentId, member.workspaceRoot, member.physicalProjectKey]),
      ),
    ),
  );
}

function useResolvedSettingsScope(rawSearch: SettingsScopeSearch, singleEnvironment: boolean) {
  const groups = useSettingsProjectGroups();
  const { environments: availableEnvironments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const search = singleEnvironment
    ? selectSingleEnvironmentScope(
        rawSearch,
        resolveSettingsScope(rawSearch, groups, availableEnvironments),
        availableEnvironments,
        primaryEnvironmentId,
      )
    : rawSearch;
  const scope = resolveSettingsScope(search, groups, availableEnvironments);
  const projectFiles = useMemberProjectFiles(scope);
  const selected = selectScopedSettingsEnvironments(scope, availableEnvironments, primaryEnvironmentId);
  const targets = resolveScopedSettingsTargets(scope, selected.connectedEnvironments, projectFiles);
  const target =
    targets.find((candidate) => candidate.environmentId === selected.environment?.environmentId) ??
    targets[0] ??
    null;
  return { scope, groups, search, ...selected, targets, target };
}

export type SettingsScopeValue = ReturnType<typeof useResolvedSettingsScope> & {
  singleEnvironment: boolean;
  search: SettingsScopeSearch;
  selectScope: (next: SettingsScopeSearch) => void;
};

const SettingsScopeContext = createContext<SettingsScopeValue | null>(null);

export function SettingsScopeProvider({
  children,
  singleEnvironment = false,
}: {
  singleEnvironment?: boolean;
  children: ReactNode;
}) {
  const [search, setSearch] = useAtom(settingsScopeSearchAtom);
  const resolved = useResolvedSettingsScope(search, singleEnvironment);
  const value: SettingsScopeValue = { ...resolved, singleEnvironment, selectScope: setSearch };
  return <SettingsScopeContext.Provider value={value}>{children}</SettingsScopeContext.Provider>;
}

export function useOptionalSettingsScope(): SettingsScopeValue | null {
  return useContext(SettingsScopeContext);
}

export function useSettingsScope(): SettingsScopeValue {
  const scope = useOptionalSettingsScope();
  if (scope === null) throw new Error("Settings scope must be read inside SettingsScopeProvider.");
  return scope;
}

// ── useScopedSettings.ts ────────────────────────────────────────────────

export function useScopedSettings(): UnifiedSettings;
export function useScopedSettings<T>(selector: (settings: UnifiedSettings) => T): T;
export function useScopedSettings<T>(selector?: (settings: UnifiedSettings) => T): T | UnifiedSettings {
  const { target } = useSettingsScope();
  const client = useClientSettings();
  const merged = mergeEnvironmentSettings(target?.settings ?? DEFAULT_SERVER_SETTINGS, client);
  return selector ? selector(merged) : merged;
}

export function useScopedSettingsMixed(keys: readonly (keyof ServerSettings)[]): boolean {
  const { targets } = useSettingsScope();
  return scopedSettingsAreMixed(targets, keys);
}

export function useScopedSettingSource(keys: readonly (keyof ServerSettings)[]) {
  const { targets } = useSettingsScope();
  return scopedSettingsSource(targets, keys);
}

function useRunScopedPlan() {
  const persistServer = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  return (plan: ReturnType<typeof planScopedSettingsPatch>) => {
    if (plan.unavailableReason) {
      toast({ type: "warning", title: "Setting not saved", description: plan.unavailableReason });
      return;
    }
    void persistScopedSettingsPatch(
      plan,
      async (request) => {
        const missing = requiredScopesForServerSettingsPatch(request.input.patch).find(
          (scope) => !readEnvironmentScope(request.environmentId, scope),
        );
        if (missing)
          return AsyncResult.failure(
            Cause.fail(
              new EnvironmentAuthorizationError({
                requiredScope: missing,
                message: "This connection lacks permission to change these settings.",
              }),
            ),
          );
        return persistServer(request);
      },
      persistClientSettingsPatch,
    ).then(({ failedEnvironments, savedEnvironments, savedEnvironmentCount }) => {
      if (failedEnvironments.length === 0) return;
      toast({
        type: "error",
        title: savedEnvironmentCount > 0 ? "Setting saved on some environments" : "Setting not saved",
        description: [
          ...failedEnvironments.map(({ label, message }) => `Could not save on ${label}: ${message}`),
          ...(savedEnvironmentCount > 0 ? [`Saved on ${savedEnvironments.map(({ label }) => label).join(", ")}.`] : []),
        ].join("\n"),
      });
    });
  };
}

export function useUpdateScopedSettings() {
  const { scope, environments } = useSettingsScope();
  const run = useRunScopedPlan();
  return (patch: ScopedSettingsPatch) => run(planScopedSettingsPatch(scope, environments, patch));
}

export function useClearScopedSettings() {
  const context = useOptionalSettingsScope();
  const run = useRunScopedPlan();
  return (keys: readonly ProjectScopedServerSettingKey[]) => {
    if (context === null) return;
    run(planScopedSettingsClear(context.scope, context.environments, keys));
  };
}

export function useClearProjectOverrides() {
  const context = useOptionalSettingsScope();
  const run = useRunScopedPlan();
  return (entries: readonly ProjectOverrideEntry[], keys: readonly ProjectScopedServerSettingKey[]) => {
    if (context === null) return;
    run(planProjectOverridesClear(context.environments, entries, keys));
  };
}

export function useScopedSettingsWriteAllowed() {
  const { connectedEnvironments } = useSettingsScope();
  const writable = useEnvironmentsWithScope(connectedEnvironments, AuthSettingsWriteScope);
  return connectedEnvironments.length > 0 && connectedEnvironments.every((target) => writable.has(target.environmentId));
}
