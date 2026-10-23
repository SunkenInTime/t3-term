// Query hooks the palette needs, ported from apps/web/src/state/query.ts
// (useEnvironmentQuery), state/queries.ts (useDebouncedValue, useThreadSearch,
// useProjectPathSearch, useProjectContentSearch) and state/filesystem.ts
// (useFilesystemReadAccess).
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { resolveFilesystemReadAccess } from "@t3tools/client-runtime/state/filesystem";
import {
  createThreadSearchResultsAtomFamily,
  makeThreadSearchKey,
  type EnvironmentThreadSearchMatch,
} from "@t3tools/client-runtime/state/thread-search";
import type { EnvironmentId, ProjectContentMatch, ProjectEntry } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import { environmentCatalog, environmentSession, projectEnvironment } from "../state/environment.ts";
import { environmentPresentations } from "../state/navigation.ts";
import { orchestrationEnvironment, projectContentSearch } from "../state/palette.ts";

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false));

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
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
  const selected = (atom ?? EMPTY_ASYNC_RESULT_ATOM) as Atom.Atom<AsyncResult.AsyncResult<A, E>>;
  const result = useAtomValue(selected);
  const refresh = useAtomRefresh(selected);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: result._tag === "Failure" ? formatQueryError(result.cause) : null,
    isPending: atom !== null && result.waiting,
    isSuccess: result._tag === "Success",
    refresh,
  };
}

export function useDebouncedValue<A>(value: A, delayMs: number): A {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const NULL_ATOM = Atom.make<null>(null);

export function useFilesystemReadAccess(environmentId: EnvironmentId | null) {
  const session = useEnvironmentQuery(
    environmentId === null ? null : environmentSession.sessionStateAtom(environmentId),
  );
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const presentation = useAtomValue(
    environmentId === null ? NULL_ATOM : environmentPresentations.presentationAtom(environmentId),
  );
  return resolveFilesystemReadAccess({
    isCatalogReady: catalog.isReady,
    connection: presentation?.connection ?? null,
    session: session.data,
    sessionError: session.error,
  });
}

// ── Thread message search ───────────────────────────────────────────────

const THREAD_SEARCH_DEBOUNCE_MS = 200;
const EMPTY_THREAD_SEARCH_MATCHES: ReadonlyArray<EnvironmentThreadSearchMatch> = Object.freeze([]);
const EMPTY_THREAD_SEARCH_ATOM = Atom.make({ matches: EMPTY_THREAD_SEARCH_MATCHES, isLoading: false });
const threadSearchResultsAtom = createThreadSearchResultsAtomFamily({
  getSearchAtom: (environmentId, query) =>
    orchestrationEnvironment.threadSearch({ environmentId, input: { query } }),
  labelPrefix: "t3term:thread-search",
});

export function useThreadSearch(environmentIds: ReadonlyArray<EnvironmentId>, query: string) {
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, THREAD_SEARCH_DEBOUNCE_MS);
  const canSearch = environmentIds.length > 0 && normalizedQuery.length >= 2;
  const settledQuery = canSearch && normalizedQuery === debouncedQuery ? debouncedQuery : null;
  const searchKey = settledQuery === null ? null : makeThreadSearchKey(environmentIds, settledQuery);
  const result = useAtomValue(searchKey === null ? EMPTY_THREAD_SEARCH_ATOM : threadSearchResultsAtom(searchKey));
  const isDebouncing = canSearch && normalizedQuery !== debouncedQuery;
  return {
    matches: isDebouncing ? EMPTY_THREAD_SEARCH_MATCHES : result.matches,
    query: settledQuery ?? "",
    isPending: canSearch && (isDebouncing || result.isLoading),
  };
}

// ── Project file and content search ─────────────────────────────────────

const PROJECT_PATH_SEARCH_DEBOUNCE_MS = 120;
const PROJECT_CONTENT_SEARCH_DEBOUNCE_MS = 120;
const PROJECT_CONTENT_SEARCH_LIMIT = 500;
const EMPTY_PROJECT_ENTRIES: ReadonlyArray<ProjectEntry> = [];
const EMPTY_CONTENT_MATCHES: ReadonlyArray<ProjectContentMatch> = [];

/** useProjectFilePickerQuery: files only, empty query allowed (lists the workspace). */
export function useProjectFilePickerQuery(
  environmentId: EnvironmentId,
  cwd: string,
  query: string,
  limit: number,
) {
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, PROJECT_PATH_SEARCH_DEBOUNCE_MS);
  const fileAccess = useFilesystemReadAccess(environmentId);
  const result = useEnvironmentQuery(
    fileAccess.canReadFiles
      ? projectEnvironment.searchEntries({
          environmentId,
          input: { cwd, query: debouncedQuery, limit, kind: "file" },
        })
      : null,
  );
  const isPending = normalizedQuery !== debouncedQuery || fileAccess.isPending || result.isPending;
  return {
    entries: isPending ? EMPTY_PROJECT_ENTRIES : (result.data?.entries ?? EMPTY_PROJECT_ENTRIES),
    error: fileAccess.isPending
      ? null
      : fileAccess.canReadFiles
        ? result.error
        : (fileAccess.error ?? "This connection cannot search host files."),
    isPending,
    matchedQuery: debouncedQuery,
  };
}

export function useProjectContentSearch(target: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly useRegex: boolean;
}) {
  const hasTarget = target.environmentId !== null && target.cwd !== null;
  const fileAccess = useFilesystemReadAccess(target.environmentId);
  const canReadFiles = hasTarget && fileAccess.canReadFiles;
  const isCheckingAccess = hasTarget && fileAccess.isPending;
  const query = target.query;
  const hasQuery = query.trim().length > 0;
  const debouncedQuery = useDebouncedValue(query, PROJECT_CONTENT_SEARCH_DEBOUNCE_MS);
  const result = useEnvironmentQuery(
    canReadFiles && target.environmentId !== null && target.cwd !== null && hasQuery && debouncedQuery.trim().length > 0
      ? projectContentSearch({
          environmentId: target.environmentId,
          input: {
            cwd: target.cwd,
            query: debouncedQuery,
            limit: PROJECT_CONTENT_SEARCH_LIMIT,
            caseSensitive: target.caseSensitive,
            wholeWord: target.wholeWord,
            useRegex: target.useRegex,
          },
        })
      : null,
  );
  return {
    canReadFiles,
    isCheckingAccess,
    matches: result.data?.matches ?? EMPTY_CONTENT_MATCHES,
    error:
      !hasTarget || isCheckingAccess
        ? null
        : canReadFiles
          ? result.error
          : (fileAccess.error ?? "This connection cannot search host files."),
    isPending: isCheckingAccess || (canReadFiles && hasQuery && (query !== debouncedQuery || result.isPending)),
    hasQuery,
    truncated: result.data?.truncated ?? false,
    invalidRegex: target.useRegex && result.data?.regexFallbackError !== undefined,
  };
}
