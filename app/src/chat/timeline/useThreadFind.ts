// apps/web/src/components/chat/useThreadFind.ts. The server counts and orders
// matches (orchestration searchThread, or searchThreadStream when the server
// counts progressively); stepping moves locally through the navigation window
// the server returned, and content that changes while the bar is open
// refreshes the results 300ms later. Kept close to web so submodule bumps diff.
//
// Differences: the bar mounts only while open (findBarOpenAtom), so the hook
// starts open; web's toast for servers without find is the keybinding's job
// here (useGlobalKeybindings checks serverConfig.threadFind).
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { OrchestrationV2SearchThreadResult, ScopedThreadRef } from "@t3tools/contracts";
import type { InlineSkill } from "@t3tools/shared/inlineSkills";
import { Atom } from "effect/reactivity";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { environmentThreadDetails } from "../../state/environment.ts";
import { timelineOrchestration } from "../../state/timeline.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";
import { type ThreadFindPositionReader, type ThreadFindStart, stepThreadFindIndex } from "../../web/components/chat/threadFind.ts";

const EMPTY_SKILLS: readonly InlineSkill[] = [];
const NO_THREAD_ATOM = Atom.make(null);

interface FindState {
  readonly query: string;
  readonly offset: number;
  readonly start: ThreadFindStart | undefined;
  readonly navigationId: number;
  readonly requestId: number;
  readonly localSelection: {
    readonly base: OrchestrationV2SearchThreadResult;
    readonly baseNavigationId: number;
    readonly activeIndex: number;
    readonly match: NonNullable<OrchestrationV2SearchThreadResult["match"]>;
    readonly navigationId: number;
  } | null;
}

const INITIAL_FIND: FindState = {
  query: "",
  offset: 0,
  start: undefined,
  navigationId: 0,
  requestId: 0,
  localSelection: null,
};

export interface ThreadFindTimelineFields {
  readonly findQuery: string;
  readonly activeFindMatch: { readonly entryId: string; readonly runId: string | null; readonly occurrence: number } | null;
  readonly findNavigationId: number;
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function useThreadFind({
  thread,
  progressive = false,
  skills = EMPTY_SKILLS,
  positionReader,
}: {
  thread: ScopedThreadRef;
  progressive?: boolean;
  skills?: readonly InlineSkill[];
  positionReader: RefObject<ThreadFindPositionReader | null>;
}) {
  // Read here rather than passed in: a streamed delta re-renders only the bar,
  // which refreshes open results from it.
  const content = useAtomValue(thread ? environmentThreadDetails.quietThreadAtom(thread) : NO_THREAD_ATOM)?.projection;
  const lastContentRef = useRef(content);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshAfterSearchRef = useRef(false);
  const threadKey = scopedThreadKey(thread);
  const [state, setState] = useState(INITIAL_FIND);

  const remote = useServerResults(thread, state.query, state.offset, state.requestId, state.start, skills, progressive);
  const status: "loading" | "error" | null = remote.error ? "error" : remote.isPending && remote.data === null ? "loading" : null;
  const localSelection = rebaseLocalSelection(state.localSelection, remote.data, remote.navigationId);
  const count = remote.data?.totalMatches ?? 0;
  const activeIndex = localSelection?.activeIndex ?? remote.data?.activeIndex ?? 0;
  const selectedMatch = localSelection?.match ?? remote.data?.match;
  const entryId = selectedMatch?.entryId;
  const runId = selectedMatch?.runId;
  const occurrence = selectedMatch?.occurrence;
  const counting = remote.data?.complete === false;
  const navigationId = localSelection?.navigationId ?? remote.navigationId;
  const timeline: ThreadFindTimelineFields = {
    findQuery: remote.data?.match ? state.query.trim() : "",
    activeFindMatch: entryId !== undefined && occurrence !== undefined ? { entryId, runId: runId ?? null, occurrence } : null,
    findNavigationId: navigationId,
  };
  const match = timeline.activeFindMatch;

  const step = (delta: number) => {
    if (count === 0 || counting) return;
    setState((previous) => {
      const local = rebaseLocalSelection(previous.localSelection, remote.data, remote.navigationId);
      const pending = previous.navigationId !== (local?.navigationId ?? remote.navigationId);
      const selected = local?.match ?? remote.data?.match;
      const nextIndex = stepThreadFindIndex(local?.activeIndex ?? remote.data?.activeIndex ?? 0, count, delta);
      const entry = remote.data?.navigation?.find(
        (entry) => nextIndex >= entry.startIndex && nextIndex < entry.startIndex + entry.count,
      );
      const nextNavigationId = previous.navigationId + 1;
      if (
        !pending &&
        !remote.isPending &&
        entry &&
        remote.data &&
        (!local ||
          local.base === remote.data ||
          remote.data.navigation?.some((entry) => entry.entryId === local.match.entryId && local.match.occurrence < entry.count)) &&
        refreshTimerRef.current === null &&
        lastContentRef.current === content
      ) {
        return {
          ...previous,
          navigationId: nextNavigationId,
          localSelection: {
            base: remote.data,
            baseNavigationId: remote.navigationId,
            activeIndex: nextIndex,
            match: { entryId: entry.entryId, runId: entry.runId, occurrence: nextIndex - entry.startIndex },
            navigationId: nextNavigationId,
          },
        };
      }
      return {
        ...previous,
        start: pending || !selected ? previous.start : { entryId: selected.entryId, occurrence: selected.occurrence },
        offset: pending ? previous.offset + delta : delta,
        navigationId: nextNavigationId,
        requestId: nextNavigationId,
      };
    });
  };

  const refreshLiveResultsRef = useRef(() => {});
  useLayoutEffect(() => {
    refreshLiveResultsRef.current = () => {
      if (!state.query.trim()) return;
      // Paging can change client content while the server is still counting.
      // Coalesce those updates instead of repeatedly restarting the scan.
      if (progressive && remote.isPending) {
        refreshAfterSearchRef.current = true;
        return;
      }
      if (!match || state.navigationId !== navigationId) {
        remote.refresh();
        return;
      }
      const start = { entryId: match.entryId, occurrence: match.occurrence };
      if (
        state.offset === 0 &&
        state.start?.entryId === start.entryId &&
        state.start.occurrence === start.occurrence &&
        state.requestId === state.navigationId
      ) {
        remote.refresh();
      } else {
        setState((previous) => ({ ...previous, start, offset: 0, requestId: previous.navigationId }));
      }
    };
  });
  useEffect(() => {
    if (!refreshAfterSearchRef.current || remote.isPending) return;
    refreshAfterSearchRef.current = false;
    if (!remote.error) refreshLiveResultsRef.current();
  }, [remote.isPending, remote.error]);
  useEffect(() => {
    if (lastContentRef.current === content) return;
    lastContentRef.current = content;
    if (!state.query.trim() || refreshTimerRef.current !== null) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      refreshLiveResultsRef.current();
    }, 300);
  }, [content, state.query]);
  useEffect(() => {
    if (!state.query.trim()) return;
    return () => {
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
      refreshAfterSearchRef.current = false;
    };
  }, [threadKey, state.query]);

  return {
    barProps: {
      query: state.query,
      matchCount: count,
      counting,
      activeIndex,
      status,
      onRetry: remote.refresh,
      onQueryChange: (query: string) => {
        const start = positionReader.current?.(query.trim());
        setState((previous) => ({
          ...previous,
          query,
          offset: 0,
          start,
          localSelection: null,
          navigationId: previous.navigationId + 1,
          requestId: previous.navigationId + 1,
        }));
      },
      onNext: () => step(1),
      onPrevious: () => step(-1),
    },
    timeline,
  };
}

function rebaseLocalSelection(
  selection: FindState["localSelection"],
  data: OrchestrationV2SearchThreadResult | null,
  navigationId: number,
) {
  if (!selection || !data) return null;
  if (selection.base === data && selection.baseNavigationId === navigationId) return selection;
  if (navigationId >= selection.navigationId) return null;
  const entry = data.navigation?.find((entry) => entry.entryId === selection.match.entryId);
  if (!entry || selection.match.occurrence >= entry.count) return selection;
  const activeIndex = entry.startIndex + selection.match.occurrence;
  return activeIndex === selection.activeIndex ? selection : { ...selection, activeIndex };
}

function useServerResults(
  thread: ScopedThreadRef,
  query: string,
  offset: number,
  navigationId: number,
  start: ThreadFindStart | undefined,
  skills: readonly InlineSkill[],
  progressive: boolean,
) {
  const skillLabels = skills.map(({ name, displayName }) => ({ name, displayName }));
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, 100);
  const target =
    debouncedQuery && normalizedQuery === debouncedQuery
      ? {
          environmentId: thread.environmentId,
          input: {
            threadId: thread.threadId,
            query: debouncedQuery,
            ...(start ? { start } : {}),
            ...(offset !== 0 ? { offset } : {}),
            skills: skillLabels,
          },
        }
      : null;
  const targetKey = target ? JSON.stringify([progressive, target]) : null;
  // Resolving the atom only when the request changes keeps unrelated renders from
  // touching the atom family.
  const [storedAtom, setStoredAtom] = useState(() => ({ key: targetKey, atom: resolveThreadFindAtom(target, progressive) }));
  let atom = storedAtom.atom;
  if (storedAtom.key !== targetKey) {
    atom = resolveThreadFindAtom(target, progressive);
    setStoredAtom({ key: targetKey, atom });
  }
  const result = useEnvironmentQuery(atom);
  const key = JSON.stringify([thread.environmentId, thread.threadId, normalizedQuery, skillLabels]);
  const [previous, setPrevious] = useState({ key, data: result.data, navigationId });
  if (
    previous.key !== key ||
    (result.data !== null &&
      (!result.isPending || (progressive && previous.data !== result.data)) &&
      (previous.data !== result.data || previous.navigationId !== navigationId))
  ) {
    setPrevious({ key, data: result.data, navigationId });
  }
  return {
    ...result,
    data: key === previous.key && !result.error ? previous.data : null,
    navigationId: previous.navigationId,
    isPending: normalizedQuery.length > 0 && (normalizedQuery !== debouncedQuery || result.isPending),
  };
}

function resolveThreadFindAtom(
  target: Parameters<typeof timelineOrchestration.threadFind>[0] | null,
  progressive: boolean,
) {
  if (!target) return null;
  return progressive ? timelineOrchestration.threadFindProgressive(target) : timelineOrchestration.threadFind(target);
}
