// Pull request atoms. Wiring follows apps/web/src/state/pullRequests.ts; the list-page state
// that web keeps in URL search params (apps/web/src/routes/_chat.pull-requests.tsx) and in its
// right panel store (apps/web/src/rightPanelStore.ts) lives in atoms here.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { useAtomValue } from "@effect/atom-react";
import {
  createPullRequestEnvironmentAtoms,
  createPullRequestStackAtomFamily,
} from "@t3tools/client-runtime/state/pull-requests";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestListInput,
  PullRequestListStatsInput,
  PullRequestMergeMethod,
  PullRequestRef,
  PullRequestReviewCommentDraft,
  ServerConfig,
} from "@t3tools/contracts";
import { ThreadPullRequestLink } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useMemo } from "react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import { termHome } from "../runtime/paths.ts";
import {
  mergePullRequestLists,
  type EnvironmentPullRequestStat,
  type MergedPullRequestList,
} from "../web/components/pullRequest/pullRequestList.logic.ts";
import {
  pullRequestListPreferences,
  readPullRequestListPreferences,
  writePullRequestListPreferences,
  type PullRequestListPreferences,
} from "../web/components/pullRequest/pullRequestListPreferences.ts";
import { pullRequestSurfaceId } from "../web/components/pullRequest/pullRequestListGroups.logic.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
} from "@t3tools/client-runtime/connection";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { environmentCatalog, environmentShell, environmentThreadShells, serverEnvironment } from "./environment.ts";
import {
  pullRequestStackView,
  savedPullRequestStack,
} from "../web/components/pullRequest/pullRequestStackSnapshot.ts";
import { persistedAtom } from "./persistedAtom.ts";
import { routeAtom } from "./ui.ts";

export const pullRequestEnvironment = createPullRequestEnvironmentAtoms(connectionAtomRuntime);

// ── Storage ─────────────────────────────────────────────────────────────

/**
 * Web keeps list preferences and the last list snapshot in localStorage. This is the same
 * getItem/setItem shape over one JSON file in the t3-term home, so the ported readers and
 * writers run unchanged.
 */
function createFileStorage(file: string): Pick<Storage, "getItem" | "setItem"> {
  let cache: Record<string, string> | null = null;
  const load = (): Record<string, string> => {
    if (cache !== null) return cache;
    try {
      const parsed = JSON.parse(NodeFS.readFileSync(file, "utf8")) as unknown;
      cache = parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      cache = {};
    }
    return cache;
  };
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    getItem: (key) => load()[key] ?? null,
    setItem: (key, value) => {
      const values = load();
      if (values[key] === value) return;
      values[key] = value;
      // Snapshots arrive in bursts while a list loads; one write per burst is enough.
      if (flushTimer !== null) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        try {
          NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
          NodeFS.writeFileSync(file, JSON.stringify(values));
        } catch {}
      }, 250);
    },
  };
}

export const pullRequestStorage = createFileStorage(
  NodePath.join(termHome(), "pull-requests-storage.json"),
);

// ── Page search state (web: URL search params) ──────────────────────────

/** apps/web/src/components/pullRequest/usePullRequestListView.ts `PullRequestsSearch`. */
export interface PullRequestsSearch extends PullRequestListPreferences {
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly host?: string;
  readonly repository?: string;
  readonly number?: number;
  readonly selectedProjectId?: ProjectId;
  readonly selectedHost?: string;
  readonly selectedEnvironmentId?: EnvironmentId;
}

export type PullRequestsSearchPatch = {
  [Key in keyof PullRequestsSearch]?: PullRequestsSearch[Key] | undefined;
};

/** The same normalisation `updateSearch` in PullRequestsPage.tsx applies to the URL. */
export function normalizePullRequestsSearch(
  previous: PullRequestsSearch,
  patch: PullRequestsSearchPatch,
): PullRequestsSearch {
  const next = { ...previous, ...patch };
  return {
    involvement: next.involvement ?? previous.involvement,
    state: next.state ?? previous.state,
    ...(next.sort && next.sort !== "ready" ? { sort: next.sort } : {}),
    ...(next.repository ? { repository: next.repository } : {}),
    ...(next.number ? { number: next.number } : {}),
    ...(next.projectId ? { projectId: next.projectId } : {}),
    ...(next.environmentId ? { environmentId: next.environmentId } : {}),
    ...(next.host ? { host: next.host } : {}),
    ...(next.selectedHost ? { selectedHost: next.selectedHost } : {}),
    ...(next.selectedProjectId ? { selectedProjectId: next.selectedProjectId } : {}),
    ...(next.selectedEnvironmentId ? { selectedEnvironmentId: next.selectedEnvironmentId } : {}),
    ...(next.q ? { q: next.q } : {}),
    ...(next.draft ? { draft: next.draft } : {}),
    ...(next.review ? { review: next.review } : {}),
    ...(next.checks ? { checks: next.checks } : {}),
    ...(next.author ? { author: next.author } : {}),
    ...(next.labels && next.labels.length > 0 ? { labels: next.labels } : {}),
  };
}

export const pullRequestsSearchAtom = Atom.make<PullRequestsSearch>(
  readPullRequestListPreferences(pullRequestStorage),
).pipe(Atom.keepAlive, Atom.withLabel("t3term-pull-requests:search"));

export function updatePullRequestsSearch(patch: PullRequestsSearchPatch): void {
  appAtomRegistry.set(
    pullRequestsSearchAtom,
    normalizePullRequestsSearch(appAtomRegistry.get(pullRequestsSearchAtom), patch),
  );
}

/** `updateListScope` in PullRequestsPage.tsx: remembers the list scope, then applies it. */
export function updatePullRequestListScope(patch: PullRequestsSearchPatch): void {
  const search = appAtomRegistry.get(pullRequestsSearchAtom);
  writePullRequestListPreferences(
    pullRequestListPreferences({
      ...search,
      ...patch,
      involvement: patch.involvement ?? search.involvement,
      state: patch.state ?? search.state,
    } as PullRequestListPreferences),
    pullRequestStorage,
  );
  updatePullRequestsSearch(patch);
}

/**
 * Opens the Pull requests page, optionally narrowed (e.g. `{ projectId, environmentId }` for one
 * project, or `{ repository, number, selectedProjectId, selectedEnvironmentId }` to open one pull
 * request's detail). Like web's `navigate({ to: "/pull-requests", search })`.
 */
export function openPullRequestsPage(patch: PullRequestsSearchPatch = {}): void {
  if (Object.keys(patch).length > 0) updatePullRequestsSearch(patch);
  appAtomRegistry.set(routeAtom, { kind: "pull-requests" });
}

// ── Detail panel (web: rightPanelStore for PULL_REQUESTS_PANEL_REF) ──────

export type PullRequestDetailTab = "summary" | "guide" | "timeline" | "code";

export interface PullRequestSurface {
  readonly id: string;
  readonly environmentId?: string;
  readonly projectId: string;
  readonly host?: string;
  readonly repository: string;
  readonly number: number;
  readonly detailTab?: PullRequestDetailTab;
}

export interface PullRequestPanelState {
  readonly isOpen: boolean;
  readonly surfaces: ReadonlyArray<PullRequestSurface>;
  readonly activeSurfaceId: string | null;
}

export const pullRequestPanelAtom = Atom.make<PullRequestPanelState>({
  isOpen: false,
  surfaces: [],
  activeSurfaceId: null,
}).pipe(Atom.keepAlive, Atom.withLabel("t3term-pull-requests:panel"));

function updatePanel(update: (state: PullRequestPanelState) => PullRequestPanelState): void {
  appAtomRegistry.set(pullRequestPanelAtom, update(appAtomRegistry.get(pullRequestPanelAtom)));
}

export const pullRequestPanel = {
  open(target: Omit<PullRequestSurface, "id">): void {
    const surface: PullRequestSurface = { ...target, id: pullRequestSurfaceId(target) };
    updatePanel((state) => ({
      isOpen: true,
      surfaces: state.surfaces.some((entry) => entry.id === surface.id)
        ? state.surfaces
        : [...state.surfaces, surface],
      activeSurfaceId: surface.id,
    }));
  },
  show(): void {
    updatePanel((state) => ({ ...state, isOpen: state.activeSurfaceId !== null }));
  },
  close(): void {
    updatePanel((state) => ({ ...state, isOpen: false }));
  },
  activate(surfaceId: string): void {
    updatePanel((state) => ({ ...state, isOpen: true, activeSurfaceId: surfaceId }));
  },
  closeSurface(surfaceId: string): void {
    updatePanel((state) => {
      const index = state.surfaces.findIndex((surface) => surface.id === surfaceId);
      if (index < 0) return state;
      const surfaces = state.surfaces.filter((surface) => surface.id !== surfaceId);
      const activeSurfaceId =
        state.activeSurfaceId !== surfaceId
          ? state.activeSurfaceId
          : (surfaces[Math.min(index, surfaces.length - 1)]?.id ?? null);
      return { isOpen: state.isOpen && activeSurfaceId !== null, surfaces, activeSurfaceId };
    });
  },
  // web rightPanelStore closeOtherSurfaces / closeSurfacesToRight / closeAllSurfaces, for the tab menu.
  closeOthers(surfaceId: string): void {
    updatePanel((state) => {
      const surfaces = state.surfaces.filter((surface) => surface.id === surfaceId);
      return { isOpen: state.isOpen && surfaces.length > 0, surfaces, activeSurfaceId: surfaces[0]?.id ?? null };
    });
  },
  closeToRight(surfaceId: string): void {
    updatePanel((state) => {
      const index = state.surfaces.findIndex((surface) => surface.id === surfaceId);
      if (index < 0) return state;
      const surfaces = state.surfaces.slice(0, index + 1);
      const activeSurfaceId = surfaces.some((surface) => surface.id === state.activeSurfaceId)
        ? state.activeSurfaceId
        : surfaceId;
      return { ...state, surfaces, activeSurfaceId };
    });
  },
  closeAll(): void {
    updatePanel(() => ({ isOpen: false, surfaces: [], activeSurfaceId: null }));
  },
  setDetailTab(surfaceId: string, detailTab: PullRequestDetailTab): void {
    updatePanel((state) => ({
      ...state,
      surfaces: state.surfaces.map((surface) =>
        surface.id === surfaceId ? { ...surface, detailTab } : surface,
      ),
    }));
  },
};

/**
 * web PullRequestDetailPanel `startAsk(..., { keepGuide: true })` opens the pull request (on its
 * Guide) in the right panel of the draft the question went to. t3-term drafts have no right panel,
 * so the draft view shows this one pull request beside its composer until it is closed.
 */
export interface DraftPullRequestPane {
  readonly draftKey: string;
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly tab: PullRequestDetailTab;
}

export const draftPullRequestPaneAtom = Atom.make<DraftPullRequestPane | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("t3term-pull-requests:draft-pane"),
);

/**
 * The detail panel's width on the Pull requests page (web RightPanelTabs `widthStorageKey`
 * "t3code:pull-request-panel-width"); null until the reader drags it, which means half the window.
 */
export const pullRequestPanelWidthAtom = persistedAtom<number | null>("pull-request-panel-width", null, (raw) =>
  typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null,
);

// ── Environments that can list pull requests ─────────────────────────────

export interface PullRequestEnvironmentPresentation {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly serverConfig: ServerConfig | null;
}

/** The parts of web's `useEnvironments()` the page reads. */
export const pullRequestEnvironmentsAtom = Atom.make(
  (get): ReadonlyArray<PullRequestEnvironmentPresentation> => {
    const catalog = get(environmentCatalog.catalogValueAtom);
    return [...catalog.entries].map(([environmentId, entry]) => ({
      environmentId,
      label: entry.target.label,
      serverConfig: get(serverEnvironment.configValueAtom(environmentId)),
    }));
  },
).pipe(Atom.withLabel("t3term-pull-requests:environments"));

/**
 * apps/web/src/state/shell.ts `allEnvironmentShellsBootstrappedAtom`: every enabled environment
 * has sent its first shell snapshot, or has given up connecting.
 */
export const pullRequestProjectsKnownAtom = Atom.make((get) => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  if (!catalog.isReady) return false;
  for (const environmentId of enabledEnvironmentIds(catalog)) {
    if (Option.isSome(get(environmentShell.stateValueAtom(environmentId)).snapshot)) continue;
    const connection = Option.getOrElse(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    if (connectionProjectionPhase(connection) !== "disconnected") return false;
  }
  return true;
}).pipe(Atom.withLabel("t3term-pull-requests:projects-known"));

/** web: `environment.connection.phase === "connected"` (deleting a branch needs a live connection). */
export const pullRequestEnvironmentConnectedAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const connection = Option.getOrElse(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    return connection.phase === "connected";
  }).pipe(Atom.withLabel(`t3term-pull-requests:connected:${environmentId}`)),
);

// ── Merged list queries (apps/web/src/state/pullRequests.ts) ─────────────

export interface EnvironmentQueryTarget<Input> {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}

interface MergedEnvironmentQueryView<A> {
  readonly values: ReadonlyArray<readonly [EnvironmentId, A]>;
  readonly error: string | null;
  readonly isPending: boolean;
}

function formatEnvironmentQueryError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The environment request failed.";
}

/**
 * React cannot subscribe to a list of atoms whose length changes, so the fan-out happens inside
 * one derived atom keyed by the targets. An environment that fails contributes nothing rather
 * than blanking the page.
 */
function createMergedEnvironmentQuery<Input, A>(
  label: string,
  atomFor: (
    target: EnvironmentQueryTarget<Input>,
  ) => Atom.Atom<AsyncResult.AsyncResult<A, unknown>>,
) {
  const family = Atom.family((key: string) =>
    Atom.make((get): MergedEnvironmentQueryView<A> => {
      const targets = JSON.parse(key) as ReadonlyArray<EnvironmentQueryTarget<Input>>;
      const values: Array<readonly [EnvironmentId, A]> = [];
      let error: string | null = null;
      let isPending = false;
      for (const target of targets) {
        const result = get(atomFor(target));
        isPending ||= result.waiting;
        if (result._tag === "Failure" && error === null) {
          error = formatEnvironmentQueryError(result.cause);
        }
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null) values.push([target.environmentId, value]);
      }
      return { values, error, isPending };
    }).pipe(Atom.withLabel(`${label}:${key}`)),
  );
  const empty = Atom.make<MergedEnvironmentQueryView<A>>({
    values: [],
    error: null,
    isPending: false,
  }).pipe(Atom.withLabel(`${label}:empty`));
  return function useMergedQuery(targets: ReadonlyArray<EnvironmentQueryTarget<Input>>) {
    const key = JSON.stringify(targets);
    const view = useAtomValue(targets.length === 0 ? empty : family(key));
    const refresh = (override?: ReadonlyArray<EnvironmentQueryTarget<Input>>) => {
      const refreshTargets =
        override ?? (JSON.parse(key) as ReadonlyArray<EnvironmentQueryTarget<Input>>);
      for (const atom of new Set(refreshTargets.map(atomFor))) {
        appAtomRegistry.refresh(atom);
      }
    };
    return { ...view, refresh };
  };
}

const usePullRequestListsQuery = createMergedEnvironmentQuery(
  "t3term-pull-requests:list",
  pullRequestEnvironment.list,
);

const usePullRequestStatsQuery = createMergedEnvironmentQuery(
  "t3term-pull-requests:list-stats",
  pullRequestEnvironment.listStats,
);

const usePullRequestTurnRefreshQuery = createMergedEnvironmentQuery(
  "t3term-pull-requests:turn-refreshes",
  ({ environmentId }: EnvironmentQueryTarget<Readonly<Record<string, never>>>) =>
    pullRequestEnvironment.refreshes({ environmentId, input: {} }),
);

export function usePullRequestTurnRefreshes(
  environmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<readonly [EnvironmentId, number]> {
  return usePullRequestTurnRefreshQuery(
    environmentIds.map((environmentId) => ({ environmentId, input: {} })),
  ).values;
}

export interface MergedPullRequestListView {
  readonly data: MergedPullRequestList | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: (targets?: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>) => void;
}

export function usePullRequestList(
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>,
): MergedPullRequestListView {
  const query = usePullRequestListsQuery(targets);
  // Web's React Compiler caches this on `query.values`; render-time state checks compare the
  // merged list by identity, so it has to stay the same object until the answers change.
  const data = useMemo(() => mergePullRequestLists(query.values), [query.values]);
  return { data, error: query.error, isPending: query.isPending, refresh: query.refresh };
}

export function usePullRequestListStats(
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListStatsInput>>,
): {
  readonly stats: ReadonlyArray<EnvironmentPullRequestStat> | null;
  readonly isPending: boolean;
  readonly refresh: (
    targets?: ReadonlyArray<EnvironmentQueryTarget<PullRequestListStatsInput>>,
  ) => void;
} {
  const query = usePullRequestStatsQuery(targets);
  const stats = useMemo(
    () =>
      query.values.length === 0
        ? null
        : query.values.flatMap(([environmentId, result]) =>
            result.stats.map((stat) => ({ ...stat, environmentId })),
          ),
    [query.values],
  );
  return { stats, isPending: query.isPending, refresh: query.refresh };
}

// ── Single-query helper (apps/web/src/state/query.ts useEnvironmentQuery) ─

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("t3term-pull-requests:empty-query"),
);

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly failure: unknown;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly refresh: () => void;
}

export function useEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A> {
  const selectedAtom = (atom ?? EMPTY_ASYNC_RESULT_ATOM) as Atom.Atom<AsyncResult.AsyncResult<A, E>>;
  const result = useAtomValue(selectedAtom);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
    failure: result._tag === "Failure" ? Option.getOrNull(Cause.findErrorOption(result.cause)) : null,
    isPending: atom !== null && result.waiting,
    isSuccess: result._tag === "Success",
    refresh: () => appAtomRegistry.refresh(selectedAtom),
  };
}

// ── Review drafts (apps/web/src/components/pullRequest/pullRequestReviewStore.ts) ──

export type PendingReviewComment = PullRequestReviewCommentDraft & { readonly id: string };

/**
 * A counter rather than anything derived from the comment: two remarks on one line can be the
 * same length, and an id built from the draft's own contents would collide with a comment that
 * was already removed.
 */
let pendingCommentSequence = 0;

export function nextPendingReviewCommentId(): string {
  pendingCommentSequence += 1;
  return `pending-review-comment-${pendingCommentSequence}`;
}

export function pullRequestReviewKey(reference: PullRequestRef): string {
  return JSON.stringify([
    reference.projectId,
    reference.host?.toLowerCase() ?? null,
    reference.repository.toLowerCase(),
    reference.number,
  ]);
}

interface PullRequestReviewDrafts {
  readonly drafts: Readonly<Record<string, ReadonlyArray<PendingReviewComment>>>;
  readonly summaries: Readonly<Record<string, string>>;
}

export const pullRequestReviewDraftsAtom = Atom.make<PullRequestReviewDrafts>({
  drafts: {},
  summaries: {},
}).pipe(Atom.keepAlive, Atom.withLabel("t3term-pull-requests:review-drafts"));

const EMPTY_PENDING_COMMENTS: ReadonlyArray<PendingReviewComment> = [];

function updateReviewDrafts(update: (state: PullRequestReviewDrafts) => PullRequestReviewDrafts) {
  appAtomRegistry.set(pullRequestReviewDraftsAtom, update(appAtomRegistry.get(pullRequestReviewDraftsAtom)));
}

function withoutKey<V>(record: Readonly<Record<string, V>>, key: string): Readonly<Record<string, V>> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export const pullRequestReviewStore = {
  addComment(key: string, comment: PendingReviewComment): void {
    updateReviewDrafts((state) => ({
      ...state,
      drafts: { ...state.drafts, [key]: [...(state.drafts[key] ?? EMPTY_PENDING_COMMENTS), comment] },
    }));
  },
  removeComments(key: string, commentIds: ReadonlyArray<string>): void {
    updateReviewDrafts((state) => {
      const submitted = new Set(commentIds);
      const remaining = (state.drafts[key] ?? EMPTY_PENDING_COMMENTS).filter((entry) => !submitted.has(entry.id));
      return {
        ...state,
        drafts: remaining.length > 0 ? { ...state.drafts, [key]: remaining } : withoutKey(state.drafts, key),
      };
    });
  },
  clear(key: string): void {
    updateReviewDrafts((state) => ({ ...state, drafts: withoutKey(state.drafts, key) }));
  },
  setSummary(key: string, body: string): void {
    updateReviewDrafts((state) => ({ ...state, summaries: { ...state.summaries, [key]: body } }));
  },
  /** Only the exact draft the host accepted: a summary revised while it was in flight is new work. */
  clearSummary(key: string, submittedBody: string): void {
    updateReviewDrafts((state) =>
      state.summaries[key] !== submittedBody ? state : { ...state, summaries: withoutKey(state.summaries, key) },
    );
  },
};

export function usePendingReviewComments(reference: PullRequestRef): ReadonlyArray<PendingReviewComment> {
  const drafts = useAtomValue(pullRequestReviewDraftsAtom);
  return drafts.drafts[pullRequestReviewKey(reference)] ?? EMPTY_PENDING_COMMENTS;
}

export function useReviewSummary(reference: PullRequestRef): string {
  const drafts = useAtomValue(pullRequestReviewDraftsAtom);
  return drafts.summaries[pullRequestReviewKey(reference)] ?? "";
}

// ── Last chosen merge method (web: uiStateStore.pullRequestMergeMethod, persisted) ──

const MERGE_METHODS: ReadonlyArray<PullRequestMergeMethod> = ["merge", "squash", "rebase"];

export const lastPullRequestMergeMethodAtom = persistedAtom<PullRequestMergeMethod | null>(
  "pull-request-merge-method",
  null,
  (raw) => (MERGE_METHODS.includes(raw as PullRequestMergeMethod) ? (raw as PullRequestMergeMethod) : null),
);

// ── Review guide runs (apps/web/src/components/pullRequest/guide/guideRunStore.ts) ──

export interface GuideRunWatch {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly title: string | null;
  readonly previousGuideAt: string | null;
  readonly previousFailedAt: string | null;
  readonly since: number;
}

export interface GuideProgress {
  readonly position: number;
  readonly seen: ReadonlySet<number>;
}

const NO_GUIDE_PROGRESS: GuideProgress = { position: 0, seen: new Set() };

interface GuideRunState {
  readonly watches: Readonly<Record<string, GuideRunWatch>>;
  readonly shownKey: string | null;
  readonly openRequestKey: string | null;
  readonly progress: Readonly<Record<string, GuideProgress>>;
}

export const guideRunStateAtom = Atom.make<GuideRunState>({
  watches: {},
  shownKey: null,
  openRequestKey: null,
  progress: {},
}).pipe(Atom.keepAlive, Atom.withLabel("t3term-pull-requests:guide-runs"));

export function guideRunKey(environmentId: EnvironmentId, reference: PullRequestRef): string {
  return `${environmentId}:${pullRequestReviewKey(reference)}`;
}

export function guideProgressKey(runKey: string, headSha: string): string {
  return `${runKey}:${headSha}`;
}

function updateGuideRuns(update: (state: GuideRunState) => GuideRunState) {
  const previous = appAtomRegistry.get(guideRunStateAtom);
  const next = update(previous);
  if (next !== previous) appAtomRegistry.set(guideRunStateAtom, next);
}

export const guideRunStore = {
  read: () => appAtomRegistry.get(guideRunStateAtom),
  setProgress(key: string, change: (current: GuideProgress) => GuideProgress): void {
    updateGuideRuns((state) => ({
      ...state,
      progress: { ...state.progress, [key]: change(state.progress[key] ?? NO_GUIDE_PROGRESS) },
    }));
  },
  watch(watch: GuideRunWatch): void {
    updateGuideRuns((state) => {
      const key = guideRunKey(watch.environmentId, watch.reference);
      if (state.watches[key] !== undefined) return state;
      return { ...state, watches: { ...state.watches, [key]: watch } };
    });
  },
  settle(key: string): void {
    updateGuideRuns((state) =>
      state.watches[key] === undefined ? state : { ...state, watches: withoutKey(state.watches, key) },
    );
  },
  setShown(shownKey: string | null): void {
    updateGuideRuns((state) => (state.shownKey === shownKey ? state : { ...state, shownKey }));
  },
  requestOpen(openRequestKey: string | null): void {
    updateGuideRuns((state) => (state.openRequestKey === openRequestKey ? state : { ...state, openRequestKey }));
  },
};

export function useGuideProgress(key: string): GuideProgress {
  return useAtomValue(guideRunStateAtom).progress[key] ?? NO_GUIDE_PROGRESS;
}

// ── Stacks (apps/web/src/state/usePullRequestStack.ts) ──────────────────

export const pullRequestStackAtom = createPullRequestStackAtomFamily(
  connectionAtomRuntime,
  pullRequestEnvironment.refreshes,
);

const sameLinks = Schema.toEquivalence(Schema.Array(ThreadPullRequestLink));

// A shell update re-sends a thread's links as a new array, so equal links keep the previous list
// and a streaming thread does not re-render the stack.
const environmentPullRequestLinksAtom = Atom.family((environmentId: EnvironmentId) => {
  let previous: ReadonlyArray<ThreadPullRequestLink> = [];
  return Atom.make((get) => {
    const next = get(environmentThreadShells.environmentThreadsAtom(environmentId)).flatMap(
      (thread) => thread.pullRequests ?? [],
    );
    if (sameLinks(previous, next)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`t3term-environment-pull-request-links:${environmentId}`));
});

export function usePullRequestStack(environmentId: EnvironmentId, reference: PullRequestRef | null) {
  const links = useAtomValue(environmentPullRequestLinksAtom(environmentId));
  const saved = reference === null ? null : savedPullRequestStack(links, reference);
  const query = useEnvironmentQuery(
    reference === null ? null : pullRequestStackAtom({ environmentId, input: reference }),
  );
  return { ...query, ...pullRequestStackView(query, saved) };
}

/** apps/web/src/state/pullRequests.ts `usePullRequestTurnRefresh`. */
export function usePullRequestTurnRefresh(environmentId: EnvironmentId): number | null {
  const result = useAtomValue(pullRequestEnvironment.refreshes({ environmentId, input: {} }));
  return Option.getOrNull(AsyncResult.value(result));
}
