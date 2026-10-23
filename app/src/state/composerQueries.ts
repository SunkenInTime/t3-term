// Server queries the composer's command menu and context strip read: VCS refs and
// status, and workspace path search. Wired the way apps/web/src/state/{vcs,query,
// queries,paginatedBranches}.ts wire them.
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { ComposerPathSearchTarget } from "@t3tools/client-runtime/state/threads";
import { createVcsEnvironmentAtoms, type VcsRefTarget } from "@t3tools/client-runtime/state/vcs";
import type { EnvironmentId, ProjectEntry, VcsListRefsResult, VcsRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import { appAtomRegistry, connectionAtomRuntime } from "../runtime/runtime.ts";
import { projectEnvironment } from "./environment.ts";

export const composerVcsEnvironment = createVcsEnvironmentAtoms(connectionAtomRuntime);

// ── useEnvironmentQuery (apps/web/src/state/query.ts) ───────────────────

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("composer-query:empty"),
);

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

function formatQueryError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The environment request failed.";
}

export function useEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A> {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  return {
    data: Option.getOrNull(AsyncResult.value(result)) as A | null,
    error: result._tag === "Failure" ? formatQueryError(result.cause) : null,
    isPending: atom !== null && result.waiting,
    refresh,
  };
}

export function useDebouncedValue<A>(value: A, delayMs: number): A {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

// ── Paginated refs (apps/web/src/state/queries.ts usePaginatedBranches) ──

const VCS_REF_LIST_LIMIT = 100;
const EMPTY_REFS: ReadonlyArray<VcsRef> = [];
const INITIAL_BRANCH_CURSORS: ReadonlyArray<number | undefined> = [undefined];

function vcsRefPageAtom(targetKey: string, cursor: number | undefined) {
  const [environmentId, cwd, query] = JSON.parse(targetKey) as [EnvironmentId, string, string];
  return composerVcsEnvironment.listRefs({
    environmentId,
    input: {
      cwd,
      ...(query.length > 0 ? { query } : {}),
      ...(cursor === undefined ? {} : { cursor }),
      limit: VCS_REF_LIST_LIMIT,
    },
  });
}

const EMPTY_VCS_REF_PAGES_ATOM = Atom.make<
  ReadonlyArray<Atom.Type<ReturnType<typeof vcsRefPageAtom>>>
>([]).pipe(Atom.withLabel("composer:vcs-ref-pages:empty"));

// Keyed by target and cursors so every render of the same pages reads the same atom.
const vcsRefPagesAtom = Atom.family((pagesKey: string) => {
  const [targetKey, cursors] = JSON.parse(pagesKey) as [string, Array<number | null>];
  const pageAtoms = cursors.map((cursor) => vcsRefPageAtom(targetKey, cursor ?? undefined));
  return Atom.make((get) => pageAtoms.map((atom) => get(atom))).pipe(
    Atom.withLabel(`composer:vcs-ref-pages:${pagesKey}`),
  );
});

function isNextPagePending<E>(
  results: ReadonlyArray<AsyncResult.AsyncResult<VcsListRefsResult, E>>,
): boolean {
  const lastResult = results.at(-1);
  return (
    results.length > 1 && lastResult?.waiting === true && Option.isNone(AsyncResult.value(lastResult))
  );
}

export function usePaginatedBranches(target: VcsRefTarget) {
  const [pagination, setPagination] = useState<{
    readonly targetKey: string | null;
    readonly cursors: ReadonlyArray<number | undefined>;
  }>({ targetKey: null, cursors: INITIAL_BRANCH_CURSORS });
  const { environmentId, cwd } = target;
  const query = target.query?.trim() ?? "";
  const targetKey =
    environmentId !== null && cwd !== null ? JSON.stringify([environmentId, cwd, query]) : null;
  const cursors = pagination.targetKey === targetKey ? pagination.cursors : INITIAL_BRANCH_CURSORS;
  const pagesKey = targetKey === null ? null : JSON.stringify([targetKey, cursors]);
  const results = useAtomValue(
    pagesKey === null ? EMPTY_VCS_REF_PAGES_ATOM : vcsRefPagesAtom(pagesKey),
  );
  const values = results.flatMap((result) => {
    const value = Option.getOrNull(AsyncResult.value(result));
    return value === null ? [] : [value];
  });
  const refs = new Map<string, VcsRef>();
  for (const value of values) {
    for (const ref of value.refs) refs.set(ref.name, ref);
  }
  const first = values[0] ?? null;
  const last = values.at(-1) ?? null;
  const data: VcsListRefsResult | null =
    first === null || last === null
      ? null
      : {
          refs: [...refs.values()],
          isRepo: first.isRepo,
          hasPrimaryRemote: first.hasPrimaryRemote,
          nextCursor: last.nextCursor,
          totalCount: Math.max(...values.map((value) => value.totalCount)),
        };
  const refresh = () => {
    setPagination({ targetKey, cursors: INITIAL_BRANCH_CURSORS });
    if (targetKey !== null) appAtomRegistry.refresh(vcsRefPageAtom(targetKey, undefined));
  };
  const nextCursor = data?.nextCursor;
  const loadNext = () => {
    if (targetKey === null || nextCursor === null || nextCursor === undefined) return;
    setPagination((current) => {
      const currentCursors =
        current.targetKey === targetKey ? current.cursors : INITIAL_BRANCH_CURSORS;
      return currentCursors.includes(nextCursor)
        ? { targetKey, cursors: currentCursors }
        : { targetKey, cursors: [...currentCursors, nextCursor] };
    });
  };
  return {
    data,
    refs: data?.refs ?? EMPTY_REFS,
    isPending: results.some((result) => result.waiting),
    isFetchingNextPage: isNextPagePending(results),
    refresh,
    loadNext,
  };
}

// ── Composer path search (apps/web/src/state/queries.ts useComposerPathSearch) ──

const PROJECT_PATH_SEARCH_DEBOUNCE_MS = 120;
const COMPOSER_PATH_SEARCH_LIMIT = 80;
const EMPTY_PROJECT_ENTRIES: ReadonlyArray<ProjectEntry> = [];

export function useComposerPathSearch(target: ComposerPathSearchTarget) {
  const normalizedTarget = {
    environmentId: target.environmentId,
    cwd: target.cwd,
    query: target.query == null ? null : target.query.trim(),
  };
  const debouncedTarget = useDebouncedValue(normalizedTarget, PROJECT_PATH_SEARCH_DEBOUNCE_MS);
  const searchTarget =
    debouncedTarget.environmentId !== null &&
    debouncedTarget.cwd !== null &&
    debouncedTarget.query !== null &&
    debouncedTarget.query.length > 0
      ? {
          environmentId: debouncedTarget.environmentId,
          input: {
            cwd: debouncedTarget.cwd,
            query: debouncedTarget.query,
            limit: COMPOSER_PATH_SEARCH_LIMIT,
          },
        }
      : null;
  const result = useEnvironmentQuery(
    searchTarget === null ? null : projectEnvironment.searchEntries(searchTarget),
  );
  const isSettled =
    normalizedTarget.environmentId === debouncedTarget.environmentId &&
    normalizedTarget.cwd === debouncedTarget.cwd &&
    normalizedTarget.query === debouncedTarget.query;
  return {
    entries: result.data?.entries ?? EMPTY_PROJECT_ENTRIES,
    error: result.error,
    isPending: !isSettled || (searchTarget !== null && result.isPending),
    searchedTarget: debouncedTarget as ComposerPathSearchTarget,
  };
}
