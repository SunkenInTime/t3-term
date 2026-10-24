// State behind the app-level coordinators web mounts in routes/__root.tsx:
// web state/server.ts (primary config event, legacy thread migration),
// state/projectClones.ts (clone progress per environment), the identities the
// host-freeze toast labels with, and hooks/useRemoveClonedProject.ts.
//
// Dev-only hooks force the states these coordinators react to, which a healthy
// reference server never reaches on its own. All are inert unless set:
//   T3TERM_DEV_KEYBINDINGS_EVENT=invalid|success
//       a synthetic `keybindingsUpdated` config event on the primary environment
//       (invalid: one `keybindings.invalid-entry` issue).
//   T3TERM_DEV_HOST_FREEZE=<seconds>[:<load>:<cpus>]
//       the primary environment reports an event-loop stall of that length.
//   T3TERM_DEV_SLOW_RPC=<count>
//       that many fake requests are tracked and never answered, so the slow
//       request toast appears after the real 15s threshold.
//   T3TERM_DEV_PROJECT_CLONE=running|done|failed|cancelled[:<project title>]
//       a fake clone snapshot for that project of the primary environment
//       (default: its first project). Its Cancel/Retry/Remove actions are real
//       commands against a project that is not being cloned: don't click them,
//       Remove project deletes the project.
//   T3TERM_DEV_LEGACY_MIGRATION=<thread count>
//       the primary environment reports a running legacy thread migration.
//   T3TERM_DEV_LEGACY_PERMISSIONS=1
//       every connected session reads as paired with legacy permissions.
import {
  scopedProjectKey,
  parseScopedProjectKey,
} from "@t3tools/client-runtime/environment";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  EDITORS,
  type EditorId,
  type EnvironmentId,
  type ProjectCloneSnapshot,
  type ProjectId,
  type ScopedProjectRef,
  type ServerConfig,
  type ServerConfigStreamEvent,
  type ServerLifecycleLegacyThreadMigrationPayload,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { toast } from "../ui/toast.tsx";
import { trackRpcRequestSent } from "../web/rpc/requestLatencyState.ts";
import { waitForAtomValue } from "../web/state/waitForAtomValue.ts";
import { clearComposerContent, composerTargetKey } from "./composer.ts";
import {
  environmentProjects,
  environmentServerConfigsAtom,
  environmentSnapshotAtom,
  projectEnvironment,
  serverEnvironment,
} from "./environment.ts";
import { sourceControlEnvironment } from "./git.ts";
import { persistedAtom } from "./persistedAtom.ts";
import { primaryEnvironmentIdAtom } from "./settings.ts";
import { routeAtom } from "./ui.ts";

const DEV_BOOT_AT = new Date().toISOString();

// ── Keybindings config events (web state/server.ts primaryServerConfigEventAtom) ──

const devKeybindingsMode = (() => {
  const mode = process.env.T3TERM_DEV_KEYBINDINGS_EVENT?.trim();
  return mode === "invalid" || mode === "success" ? mode : null;
})();
// Built once, so later config pushes don't read as a second edit.
let devKeybindingsEvent: ServerConfigStreamEvent | null = null;

function devKeybindingsEventFor(config: ServerConfig): ServerConfigStreamEvent {
  devKeybindingsEvent ??= {
    version: 1,
    type: "keybindingsUpdated",
    payload: {
      keybindings: config.keybindings,
      issues:
        devKeybindingsMode === "invalid"
          ? [
              {
                kind: "keybindings.invalid-entry",
                message: 'Invalid keybinding at index 34: unknown command "t3term.dev.invalid".',
                index: 34,
              },
            ]
          : [],
    },
  };
  return devKeybindingsEvent;
}

export const primaryServerConfigEventAtom = Atom.make((get): ServerConfigStreamEvent | null => {
  const environmentId = get(primaryEnvironmentIdAtom);
  if (environmentId === null) return null;
  const projection = Option.getOrNull(
    AsyncResult.value(get(serverEnvironment.configProjection({ environmentId, input: {} }))),
  );
  // The synthetic event stands in once the real config has arrived, like a file edit would.
  if (devKeybindingsMode !== null && projection !== null) return devKeybindingsEventFor(projection.config);
  return projection?.latestEvent ?? null;
}).pipe(Atom.withLabel("t3term-primary-server-config-event"));

export const primaryServerConfigAtom = Atom.make((get): ServerConfig | null => {
  const environmentId = get(primaryEnvironmentIdAtom);
  return environmentId === null ? null : get(serverEnvironment.configValueAtom(environmentId));
}).pipe(Atom.withLabel("t3term-primary-server-config"));

/**
 * web editorPreferences.ts resolveAndPersistPreferredEditor: the last editor
 * picked if this environment has it, else the first known editor it has.
 */
export function resolvePreferredEditor(
  current: EditorId | "",
  availableEditors: ReadonlyArray<EditorId>,
): EditorId | null {
  if (current !== "" && availableEditors.includes(current)) return current;
  return EDITORS.find((editor) => availableEditors.includes(editor.id))?.id ?? null;
}

// ── Host freeze (web HostFreezeToastCoordinator reads environmentServerConfigsAtom) ──

const devHostFreeze = (() => {
  const raw = process.env.T3TERM_DEV_HOST_FREEZE?.trim();
  if (!raw) return null;
  const [seconds, load, cpus] = raw.split(":").map(Number);
  if (!seconds || !Number.isFinite(seconds)) return null;
  return {
    detectedAt: DEV_BOOT_AT,
    durationMs: Math.round(seconds * 1000),
    ...(load !== undefined && Number.isFinite(load) ? { loadAverage: load } : {}),
    cpuCount: cpus && Number.isFinite(cpus) ? cpus : 8,
  } satisfies NonNullable<ServerConfig["lastEventLoopStall"]>;
})();

export const hostFreezeServerConfigsAtom = Atom.make((get): ReadonlyMap<EnvironmentId, ServerConfig> => {
  const configs = get(environmentServerConfigsAtom);
  if (devHostFreeze === null) return configs;
  const primary = get(primaryEnvironmentIdAtom);
  const config = primary === null ? undefined : configs.get(primary);
  if (primary === null || config === undefined) return configs;
  const next = new Map(configs);
  next.set(primary, { ...config, lastEventLoopStall: devHostFreeze });
  return next;
}).pipe(Atom.withLabel("t3term-host-freeze-server-configs"));

// ── Slow requests ──

let devSlowRequestsStarted = false;

/** Starts T3TERM_DEV_SLOW_RPC's never-answered requests once, on the coordinator's mount. */
export function startDevSlowRequests(): void {
  if (devSlowRequestsStarted) return;
  devSlowRequestsStarted = true;
  const count = Number(process.env.T3TERM_DEV_SLOW_RPC ?? "");
  if (!Number.isFinite(count) || count <= 0) return;
  const methods = ["orchestration.dispatchCommand", "vcs.listRefs", "projects.searchEntries"];
  for (let index = 0; index < count; index += 1) {
    const method = methods[index % methods.length]!;
    trackRpcRequestSent(`t3term-dev:${index}`, method, `${method} · dev`);
  }
}

// ── Legacy thread migration (web state/server.ts primaryServerLegacyThreadMigrationAtom) ──

const devLegacyMigration = (() => {
  const count = Number(process.env.T3TERM_DEV_LEGACY_MIGRATION ?? "");
  return Number.isFinite(count) && count > 0
    ? ({ status: "running", totalThreadCount: Math.round(count) } as const)
    : null;
})();

export const primaryServerLegacyThreadMigrationAtom = Atom.make(
  (get): ServerLifecycleLegacyThreadMigrationPayload | null => {
    const environmentId = get(primaryEnvironmentIdAtom);
    if (environmentId === null) return null;
    if (devLegacyMigration !== null) return devLegacyMigration;
    return Option.getOrNull(
      AsyncResult.value(get(serverEnvironment.legacyThreadMigration({ environmentId, input: {} }))),
    );
  },
).pipe(Atom.withLabel("t3term-primary-server-legacy-thread-migration"));

// ── Permission update notice ──

export const devLegacyPermissions = process.env.T3TERM_DEV_LEGACY_PERMISSIONS === "1";

/** web keeps `t3code:permission-update:v1:<environmentId>` in localStorage. */
export const permissionUpdateDismissedAtom = persistedAtom<Readonly<Record<string, true>>>(
  "permissionUpdateDismissed",
  {},
  (raw) =>
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (Object.fromEntries(
          Object.entries(raw).filter(([, value]) => value === true),
        ) as Record<string, true>)
      : {},
);

export function persistPermissionUpdateDismissal(environmentId: EnvironmentId): void {
  appAtomRegistry.set(permissionUpdateDismissedAtom, {
    ...appAtomRegistry.get(permissionUpdateDismissedAtom),
    [environmentId]: true,
  });
}

// ── Project clones (web state/projectClones.ts) ──

const EMPTY_CLONES: ReadonlyArray<ProjectCloneSnapshot> = [];
const EMPTY_CLONE_ATOM = Atom.make<ProjectCloneSnapshot | null>(null).pipe(
  Atom.withLabel("t3term-project-clone:empty"),
);

const devProjectClone = (() => {
  const raw = process.env.T3TERM_DEV_PROJECT_CLONE?.trim();
  if (!raw) return null;
  const separator = raw.indexOf(":");
  const phase = (separator === -1 ? raw : raw.slice(0, separator)) as ProjectCloneSnapshot["phase"];
  if (!["running", "done", "failed", "cancelled"].includes(phase)) return null;
  return { phase, projectTitle: separator === -1 ? null : raw.slice(separator + 1) };
})();

const devProjectClonesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<ProjectCloneSnapshot> => {
    if (devProjectClone === null || get(primaryEnvironmentIdAtom) !== environmentId) return EMPTY_CLONES;
    const projects = get(environmentSnapshotAtom(environmentId))?.projects ?? [];
    const project =
      devProjectClone.projectTitle === null
        ? projects[0]
        : projects.find((candidate) => candidate.title === devProjectClone.projectTitle);
    if (!project) return EMPTY_CLONES;
    const { phase } = devProjectClone;
    return [
      {
        projectId: project.id,
        remoteUrl: "https://github.com/pingdotgg/t3code.git",
        destinationPath: project.workspaceRoot,
        repository: null,
        phase,
        stage: "receiving",
        percent: phase === "done" ? 100 : 42,
        detail: "18.40 MiB | 6.12 MiB/s",
        error: phase === "failed" ? "fatal: unable to access 'https://github.com/pingdotgg/t3code.git/': Could not resolve host: github.com" : null,
        startedAt: DEV_BOOT_AT,
        endedAt: phase === "running" ? null : DEV_BOOT_AT,
        sequence: 1,
      } as ProjectCloneSnapshot,
    ];
  }),
);

export const environmentProjectClonesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<ProjectCloneSnapshot> => {
    const dev = get(devProjectClonesAtom(environmentId));
    if (dev.length > 0) return dev;
    const supported =
      get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
        .projectCloneTracking === true;
    if (!supported) return EMPTY_CLONES;
    const result = get(sourceControlEnvironment.projectClones({ environmentId, input: {} }));
    return Option.getOrElse(AsyncResult.value(result), () => EMPTY_CLONES);
  }).pipe(Atom.withLabel(`t3term-project-clones:${environmentId}`)),
);

const projectCloneAtom = Atom.family((key: string) => {
  const ref = parseScopedProjectKey(key);
  return Atom.make((get): ProjectCloneSnapshot | null => {
    if (ref === null) return null;
    const clones = get(environmentProjectClonesAtom(ref.environmentId));
    return clones.find((clone) => clone.projectId === ref.projectId) ?? null;
  }).pipe(Atom.withLabel(`t3term-project-clone:${key}`));
});

export function projectCloneAtomFor(ref: ScopedProjectRef | null): Atom.Atom<ProjectCloneSnapshot | null> {
  return ref === null ? EMPTY_CLONE_ATOM : projectCloneAtom(scopedProjectKey(ref));
}

const silencedCloneToasts = new Set<string>();

/**
 * Keeps a clone's progress out of toasts once the user is looking at its
 * project, whose composer shows the same progress. Failures still toast
 * whenever the project is not on screen.
 */
export function silenceProjectCloneToasts(ref: ScopedProjectRef) {
  silencedCloneToasts.add(scopedProjectKey(ref));
}

export function isProjectCloneToastSilenced(ref: ScopedProjectRef): boolean {
  return silencedCloneToasts.has(scopedProjectKey(ref));
}

/** True while the route is the new-thread draft of this project (web: a draft route of it). */
export function isViewingProjectDraft(environmentId: EnvironmentId, projectId: ProjectId): boolean {
  const route = appAtomRegistry.get(routeAtom);
  return route.kind === "draft" && route.environmentId === environmentId && route.projectId === projectId;
}

/**
 * web hooks/useRemoveClonedProject.ts: deletes a project whose clone never
 * landed, drops its new-thread draft, and leaves its draft route.
 */
export async function removeClonedProject(projectRef: ScopedProjectRef): Promise<boolean> {
  const result = await runAtomCommand(
    appAtomRegistry,
    projectEnvironment.delete,
    {
      environmentId: projectRef.environmentId,
      // Not forced: a project whose clone never landed has no threads, and
      // if one appeared in the meantime the server refuses rather than
      // silently deleting it.
      input: { projectId: projectRef.projectId },
    },
    { reportFailure: false },
  );
  if (result._tag === "Failure") {
    const error = squashAtomCommandFailure(result);
    toast({
      type: "error",
      title: "Failed to remove project",
      description: error instanceof Error ? error.message : "An error occurred.",
      actionLayout: "stacked-end",
    });
    return false;
  }
  await waitForAtomValue({
    registry: appAtomRegistry,
    atom: environmentProjects.projectAtom(projectRef),
    predicate: (project) => project === null,
    timeoutMs: 5_000,
  });
  // Read the route after the await: the user may have moved on while the
  // delete was in flight, and only a draft of this project needs to go.
  const viewingThisProject = isViewingProjectDraft(projectRef.environmentId, projectRef.projectId);
  clearComposerContent(
    composerTargetKey({ kind: "draft", environmentId: projectRef.environmentId, projectId: projectRef.projectId }),
  );
  if (viewingThisProject) appAtomRegistry.set(routeAtom, { kind: "home" });
  return true;
}
