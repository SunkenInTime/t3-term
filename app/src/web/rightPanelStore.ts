// Ported from apps/web/src/rightPanelStore.ts (pure reducers only). The zustand
// store, its persistence and the closed-view memory stay behind; state/rightPanel.ts
// wraps these reducers in atoms.

export type RightPanelKind =
  | "diff"
  | "files"
  | "file"
  | "preview"
  | "device"
  | "terminal"
  | "pull-request"
  | "pull-requests";

export type PullRequestDetailTab = "summary" | "guide" | "timeline" | "code";

export interface DeviceTabTarget {
  hostId: string;
  deviceId: string;
  platform: "ios" | "android";
  name: string;
}

export type RightPanelSurface =
  | { id: `browser:${string}`; kind: "preview"; resourceId: string }
  | { id: "browser:new"; kind: "preview"; resourceId: null }
  | { id: "device" | `device:${string}`; kind: "device"; target?: DeviceTabTarget; title?: string }
  | {
      id: `terminal:${string}`;
      kind: "terminal";
      resourceId: string;
      terminalIds: string[];
      activeTerminalId: string;
      splitDirection?: "horizontal" | "vertical";
    }
  | { id: "diff"; kind: "diff" }
  | {
      id: "files";
      kind: "files";
      /** Set when breadcrumbs moved a folder browser up to the workspace root. */
      folderTrail?: string;
    }
  | {
      id: `file:${string}`;
      kind: "file";
      relativePath: string;
      revealLine: number | null;
      revealRequestId: number;
      folderTrail?: string;
    }
  | {
      id: `pull-request:${string}`;
      kind: "pull-request";
      environmentId?: string;
      projectId: string;
      host?: string;
      repository: string;
      number: number;
      url?: string;
      detailTab?: PullRequestDetailTab;
    }
  | { id: "pull-requests"; kind: "pull-requests" };

export interface ThreadRightPanelState {
  isOpen: boolean;
  activeSurfaceId: string | null;
  surfaces: RightPanelSurface[];
  maximized?: true;
  /** Device tabs the user closed, so an agent-opened session does not reopen them. */
  dismissedDeviceSurfaceIds?: string[];
}

export const EMPTY_THREAD_STATE: ThreadRightPanelState = {
  isOpen: false,
  activeSurfaceId: null,
  surfaces: [],
};

export type SingletonKind = Exclude<RightPanelKind, "file" | "preview" | "terminal" | "pull-request">;

export const singletonSurface = (kind: SingletonKind): RightPanelSurface => {
  switch (kind) {
    case "diff":
      return { id: "diff", kind };
    case "files":
      return { id: "files", kind };
    case "pull-requests":
      return { id: "pull-requests", kind };
    case "device":
      return { id: "device", kind };
  }
};

export const browserSurface = (tabId: string | null): RightPanelSurface =>
  tabId
    ? { id: `browser:${tabId}`, kind: "preview", resourceId: tabId }
    : { id: "browser:new", kind: "preview", resourceId: null };

export const fileSurface = (
  relativePath: string,
  revealLine: number | null,
  revealRequestId: number,
): RightPanelSurface => ({
  id: `file:${relativePath}`,
  kind: "file",
  relativePath,
  revealLine,
  revealRequestId,
});

export const terminalSurface = (terminalId: string): RightPanelSurface => ({
  id: `terminal:${terminalId}`,
  kind: "terminal",
  resourceId: terminalId,
  terminalIds: [terminalId],
  activeTerminalId: terminalId,
});

export type PullRequestSurface = Extract<RightPanelSurface, { kind: "pull-request" }>;

export function pullRequestSurfaceId(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
}): PullRequestSurface["id"] {
  const scope =
    target.environmentId === undefined ? "" : `${encodeURIComponent(target.environmentId)}:`;
  const host = target.host === undefined ? "" : `${encodeURIComponent(target.host.toLowerCase())}:`;
  return `pull-request:${scope}${encodeURIComponent(target.projectId)}:${host}${encodeURIComponent(target.repository)}:${target.number}`;
}

export function pullRequestSurface(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
  url?: string;
  detailTab?: PullRequestDetailTab;
}): PullRequestSurface {
  return {
    id: pullRequestSurfaceId(target),
    kind: "pull-request",
    ...(target.environmentId === undefined ? {} : { environmentId: target.environmentId }),
    projectId: target.projectId,
    ...(typeof target.host === "string" ? { host: target.host.toLowerCase() } : {}),
    repository: target.repository,
    number: target.number,
    ...(typeof target.url === "string" ? { url: target.url } : {}),
    ...(target.detailTab === undefined ? {} : { detailTab: target.detailTab }),
  };
}

export const upsertSurface = (
  current: ThreadRightPanelState,
  surface: RightPanelSurface,
  activate = true,
): ThreadRightPanelState => ({
  ...current,
  isOpen: true,
  surfaces: current.surfaces.some((entry) => entry.id === surface.id)
    ? current.surfaces
    : [...current.surfaces, surface],
  activeSurfaceId: activate ? surface.id : current.activeSurfaceId,
});

function normalizeRevealLine(line: number | undefined): number | null {
  if (line === undefined || !Number.isFinite(line)) return null;
  return Math.max(1, Math.trunc(line));
}

export function openSingleton(current: ThreadRightPanelState, kind: SingletonKind | "preview") {
  if (kind === "preview") {
    const existing = current.surfaces.find((surface) => surface.kind === "preview");
    return upsertSurface(current, existing ?? browserSurface(null));
  }
  return upsertSurface(current, singletonSurface(kind));
}

/** web: `openBrowser`. A real tab replaces the "browser:new" placeholder. */
export function openBrowser(current: ThreadRightPanelState, tabId: string | null): ThreadRightPanelState {
  const surface = browserSurface(tabId);
  const withoutPlaceholder = tabId ? current.surfaces.filter((entry) => entry.id !== "browser:new") : current.surfaces;
  return upsertSurface({ ...current, surfaces: withoutPlaceholder }, surface);
}

/**
 * web: `reconcileBrowserSurfaces`. Browser tabs follow the server's preview
 * sessions, so a tab an agent opened appears and a closed one goes away.
 */
export function reconcileBrowserSurfaces(
  current: ThreadRightPanelState,
  tabIds: ReadonlyArray<string>,
  hiddenTabIds?: ReadonlySet<string>,
): ThreadRightPanelState {
  const validIds = new Set(tabIds.map((tabId) => `browser:${tabId}`));
  const kept = current.surfaces.filter(
    (surface) => surface.kind !== "preview" || (surface.id !== "browser:new" && validIds.has(surface.id)),
  );
  const knownIds = new Set(kept.map((surface) => surface.id));
  const added = tabIds
    .filter((tabId) => !knownIds.has(`browser:${tabId}`) && !hiddenTabIds?.has(tabId))
    .map((tabId) => browserSurface(tabId));
  if (added.length === 0 && kept.length === current.surfaces.length) return current;
  const surfaces = [...kept, ...added];
  const activeStillExists = surfaces.some((surface) => surface.id === current.activeSurfaceId);
  const fallbackBrowser = surfaces.find((surface) => surface.kind === "preview");
  return {
    ...current,
    surfaces,
    activeSurfaceId: activeStillExists ? current.activeSurfaceId : (fallbackBrowser?.id ?? surfaces[0]?.id ?? null),
  };
}

export function openPullRequest(
  current: ThreadRightPanelState,
  target: Parameters<typeof pullRequestSurface>[0],
): ThreadRightPanelState {
  const surface = pullRequestSurface(target);
  const next = upsertSurface(current, surface);
  return target.url
    ? {
        ...next,
        surfaces: next.surfaces.map((entry) =>
          entry.id === surface.id && entry.kind === "pull-request" ? { ...entry, ...surface } : entry,
        ),
      }
    : next;
}

export function openFile(
  current: ThreadRightPanelState,
  requestedPath: string,
  line?: number,
): ThreadRightPanelState {
  if (requestedPath === ".") {
    return upsertSurface(current, singletonSurface("files"));
  }
  // Workspace entry paths use '/', including on Windows.
  const relativePath = /^[A-Za-z]:\/+$/.test(requestedPath)
    ? requestedPath
    : requestedPath.replace(/\/+$/, "") || requestedPath;
  const withoutStandaloneExplorer = current.surfaces.filter((surface) => surface.kind !== "files");
  const surfaceId = `file:${relativePath}` as const;
  const existing = withoutStandaloneExplorer.find(
    (surface): surface is Extract<RightPanelSurface, { kind: "file" }> =>
      surface.id === surfaceId && surface.kind === "file",
  );
  const surface = fileSurface(relativePath, normalizeRevealLine(line), (existing?.revealRequestId ?? 0) + 1);
  return {
    ...current,
    isOpen: true,
    activeSurfaceId: surface.id,
    surfaces: existing
      ? withoutStandaloneExplorer.map((entry) => (entry.id === surface.id ? surface : entry))
      : [...withoutStandaloneExplorer, surface],
  };
}

export function navigateFolder(
  current: ThreadRightPanelState,
  surfaceId: string,
  relativePath: string,
  folderTrail: string,
  keepSource = false,
): ThreadRightPanelState {
  const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
  if (index < 0) return current;
  const trail = folderTrail === relativePath ? {} : { folderTrail };
  const target: RightPanelSurface =
    relativePath === ""
      ? { ...singletonSurface("files"), ...trail }
      : { ...fileSurface(relativePath, null, 1), ...trail };
  const source = current.surfaces[index]!;
  // A tab already showing the target wins, so its state is never replaced.
  const existing = current.surfaces.some((surface, i) => i !== index && surface.id === target.id);
  const surfaces = current.surfaces.flatMap((surface, i) => {
    if (i === index) {
      const kept = keepSource ? [source] : [];
      return existing ? kept : [...kept, target];
    }
    // Like openFile: a file surface replaces the standalone explorer.
    return !existing && target.kind === "file" && surface.kind === "files" ? [] : [surface];
  });
  return { ...current, isOpen: true, activeSurfaceId: target.id, surfaces };
}

export function openTerminal(current: ThreadRightPanelState, terminalId: string) {
  return upsertSurface(current, terminalSurface(terminalId));
}

export function splitTerminal(
  current: ThreadRightPanelState,
  surfaceId: string,
  terminalId: string,
  direction: "horizontal" | "vertical" = "horizontal",
): ThreadRightPanelState {
  return {
    ...current,
    isOpen: true,
    activeSurfaceId: surfaceId,
    surfaces: current.surfaces.map((surface) => {
      if (surface.id !== surfaceId || surface.kind !== "terminal") return surface;
      const { splitDirection: _splitDirection, ...baseSurface } = surface;
      return {
        ...baseSurface,
        terminalIds: surface.terminalIds.includes(terminalId)
          ? surface.terminalIds
          : [...surface.terminalIds, terminalId],
        activeTerminalId: terminalId,
        ...(direction === "vertical" ? { splitDirection: "vertical" as const } : {}),
      };
    }),
  };
}

export function activateTerminal(
  current: ThreadRightPanelState,
  surfaceId: string,
  terminalId: string,
): ThreadRightPanelState {
  return {
    ...current,
    activeSurfaceId: surfaceId,
    surfaces: current.surfaces.map((surface) =>
      surface.id === surfaceId && surface.kind === "terminal" && surface.terminalIds.includes(terminalId)
        ? { ...surface, activeTerminalId: terminalId }
        : surface,
    ),
  };
}

export function closeTerminal(
  current: ThreadRightPanelState,
  surfaceId: string,
  terminalId: string,
): ThreadRightPanelState {
  const surface = current.surfaces.find((entry) => entry.id === surfaceId && entry.kind === "terminal");
  if (!surface || surface.kind !== "terminal") return current;
  const terminalIds = surface.terminalIds.filter((id) => id !== terminalId);
  if (terminalIds.length === 0) {
    const index = current.surfaces.findIndex((entry) => entry.id === surfaceId);
    const surfaces = current.surfaces.filter((entry) => entry.id !== surfaceId);
    const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
    return {
      ...current,
      isOpen: surfaces.length > 0 && current.isOpen,
      surfaces,
      activeSurfaceId: current.activeSurfaceId === surfaceId ? (fallback?.id ?? null) : current.activeSurfaceId,
    };
  }
  return {
    ...current,
    surfaces: current.surfaces.map((entry) =>
      entry.id === surfaceId && entry.kind === "terminal"
        ? {
            ...entry,
            terminalIds,
            activeTerminalId:
              entry.activeTerminalId === terminalId
                ? (terminalIds.at(-1) ?? terminalIds[0]!)
                : entry.activeTerminalId,
          }
        : entry,
    ),
  };
}

export function activateSurface(current: ThreadRightPanelState, surfaceId: string) {
  return current.surfaces.some((surface) => surface.id === surfaceId)
    ? { ...current, isOpen: true, activeSurfaceId: surfaceId }
    : current;
}

export function closeSurface(current: ThreadRightPanelState, surfaceId: string): ThreadRightPanelState {
  const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
  if (index < 0) return current;
  const surfaces = current.surfaces.filter((surface) => surface.id !== surfaceId);
  const next = { ...current, isOpen: surfaces.length > 0 && current.isOpen, surfaces };
  if (current.activeSurfaceId !== surfaceId) return next;
  const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
  return { ...next, activeSurfaceId: fallback?.id ?? null };
}

export function closeOtherSurfaces(current: ThreadRightPanelState, surfaceId: string) {
  const surface = current.surfaces.find((entry) => entry.id === surfaceId);
  if (!surface || current.surfaces.length === 1) return current;
  return { ...current, isOpen: true, surfaces: [surface], activeSurfaceId: surface.id };
}

export function closeSurfacesToRight(current: ThreadRightPanelState, surfaceId: string) {
  const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
  if (index < 0 || index === current.surfaces.length - 1) return current;
  const surfaces = current.surfaces.slice(0, index + 1);
  const activeStillExists = surfaces.some((surface) => surface.id === current.activeSurfaceId);
  return { ...current, surfaces, activeSurfaceId: activeStillExists ? current.activeSurfaceId : surfaceId };
}

export function closeAllSurfaces(current: ThreadRightPanelState): ThreadRightPanelState {
  return current.surfaces.length === 0
    ? current
    : { ...current, isOpen: false, surfaces: [], activeSurfaceId: null };
}

export function moveSurface(current: ThreadRightPanelState, surfaceId: string, toIndex: number) {
  const fromIndex = current.surfaces.findIndex((surface) => surface.id === surfaceId);
  if (fromIndex < 0 || fromIndex === toIndex) return current;
  const surfaces = [...current.surfaces];
  surfaces.splice(toIndex, 0, ...surfaces.splice(fromIndex, 1));
  return { ...current, surfaces };
}

export function toggleKind(current: ThreadRightPanelState, kind: SingletonKind | "preview") {
  const active = current.surfaces.find((surface) => surface.id === current.activeSurfaceId);
  if (current.isOpen && active?.kind === kind) return { ...current, isOpen: false };
  return openSingleton(current, kind);
}

export function setMaximized(current: ThreadRightPanelState, maximized: boolean): ThreadRightPanelState {
  if ((current.maximized ?? false) === maximized) return current;
  const { maximized: _maximized, ...rest } = current;
  return maximized ? { ...rest, maximized: true } : rest;
}

export function selectedSurface(state: ThreadRightPanelState): RightPanelSurface | null {
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
}

/** rightPanelStore userAction: device tabs a user action removed are remembered as dismissed. */
export function rememberDismissedDevices(
  current: ThreadRightPanelState,
  next: ThreadRightPanelState,
): ThreadRightPanelState {
  if (next === current) return next;
  const removed = current.surfaces.filter(
    (surface) => surface.kind === "device" && !next.surfaces.some((entry) => entry.id === surface.id),
  );
  if (removed.length === 0) return next;
  return {
    ...next,
    dismissedDeviceSurfaceIds: [
      ...new Set([...(next.dismissedDeviceSurfaceIds ?? []), ...removed.map((surface) => surface.id)]),
    ],
  };
}

/** rightPanelStore openDevice. `automatic` (an agent opened it) respects a user's dismissal. */
export function openDevice(
  current: ThreadRightPanelState,
  target: DeviceTabTarget,
  automatic = false,
): ThreadRightPanelState {
  const id = `device:${encodeURIComponent(target.hostId)}:${encodeURIComponent(target.deviceId)}` as const;
  if (automatic && current.dismissedDeviceSurfaceIds?.includes(id)) return current;
  const surface: RightPanelSurface = { id, kind: "device", target };
  const existing = current.surfaces.find((entry) => entry.id === id);
  const surfaces = existing
    ? current.surfaces.filter((entry) => entry.id !== "device")
    : current.surfaces.map((entry) => (entry.id === "device" ? surface : entry));
  return upsertSurface(
    {
      ...current,
      surfaces,
      dismissedDeviceSurfaceIds: (current.dismissedDeviceSurfaceIds ?? []).filter((entry) => entry !== id),
    },
    existing ?? surface,
  );
}

/** rightPanelStore renameDevice: an empty title falls back to the device's name. */
export function renameDevice(current: ThreadRightPanelState, surfaceId: string, title: string): ThreadRightPanelState {
  return {
    ...current,
    surfaces: current.surfaces.map((surface) =>
      surface.id === surfaceId && surface.kind === "device"
        ? { ...surface, title: title.trim() || surface.target?.name || "Device" }
        : surface,
    ),
  };
}
