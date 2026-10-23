// apps/web/src/components/chat/ThreadFindBar.tsx + a trimmed useThreadFind.ts.
// The server counts and orders matches (orchestration searchThread), the
// timeline opens the fold that holds the active match and scrolls to its row,
// and gpuix's native `highlight` paints the matches.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import { timelineOrchestration } from "../../state/timeline.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { FONTS, RADIUS, useTheme } from "../../ui/theme.ts";
import { formatThreadFindCount, stepThreadFindIndex } from "../../web/components/chat/threadFind.ts";

const EMPTY_FIND_ATOM = Atom.make(AsyncResult.initial<never, never>(false));

export interface ThreadFindState {
  readonly query: string;
  readonly match: { readonly entryId: string; readonly occurrence: number } | null;
  /** Bumps on every navigation, so the timeline scrolls even when the match repeats. */
  readonly navigationId: number;
}

/** The query is sent 150ms after typing stops, like web's debounced find. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function ThreadFindBar({
  environmentId,
  threadId,
  onChange,
  onClose,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onChange: (state: ThreadFindState) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [requestedIndex, setRequestedIndex] = useState(0);
  const [navigationId, setNavigationId] = useState(0);
  const trimmed = useDebounced(query.trim(), 150);
  const result = useAtomValue(
    trimmed.length > 0
      ? timelineOrchestration.threadFind({ environmentId, input: { threadId, query: trimmed, index: requestedIndex } })
      : EMPTY_FIND_ATOM,
  );
  const data = result._tag === "Success" ? result.value : null;
  const total = data?.totalMatches ?? 0;
  const activeIndex = data?.activeIndex ?? 0;
  const status = trimmed.length === 0 ? null : result._tag === "Failure" ? "error" : data === null ? "loading" : null;
  const match = data?.match ?? null;

  useEffect(() => {
    onChange({ query: trimmed, match: match ? { entryId: match.entryId, occurrence: match.occurrence } : null, navigationId });
    // onChange is stable in the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, match?.entryId, match?.occurrence, navigationId]);

  const step = (delta: number) => {
    if (total === 0) return;
    setRequestedIndex(stepThreadFindIndex(activeIndex, total, delta));
    setNavigationId((id) => id + 1);
  };

  const hasQuery = query.trim().length > 0;
  const noResults = hasQuery && status === null && total === 0 && trimmed.length > 0;
  const label = status === "loading" ? "Searching…" : status === "error" ? "Search failed" : hasQuery ? formatThreadFindCount(activeIndex, total) : "";
  const navigationDisabled = total === 0 || status === "loading";

  const iconButton = (icon: IconName, onClick: () => void, disabled: boolean, testId: string) => (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: RADIUS.md,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      <Icon name={icon} size={14} color={theme.mutedForeground} />
    </div>
  );

  return (
    <div
      testId="thread-find-bar"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: 36,
        width: "100%",
        paddingLeft: 10,
        paddingRight: 4,
        gap: 2,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: theme.popover,
        boxShadow: { offsetX: 0, offsetY: 16, blurRadius: 40, spreadRadius: -18, color: "#0000008c" },
        pointerEvents: "auto",
      }}
    >
      <input
        testId="thread-find-input"
        autoFocus
        value={query}
        placeholder="Find in thread"
        onChange={(event) => {
          setQuery((event.value ?? "").slice(0, 200));
          setRequestedIndex(0);
        }}
        onSubmit={() => step(1)}
        onKeyDown={(event) => {
          if (event.key === "escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 34, fontSize: 14, fontFamily: FONTS.sans, color: theme.foreground }}
      />
      <div style={{ display: "flex", justifyContent: "center", minWidth: 40, flexShrink: 0 }}>
        <text style={{ color: noResults ? theme.errorForeground : theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>
          {label}
        </text>
      </div>
      {iconButton("chevron-up", () => step(-1), navigationDisabled, "thread-find-previous")}
      {iconButton("chevron-down", () => step(1), navigationDisabled, "thread-find-next")}
      {iconButton("x", onClose, false, "thread-find-close")}
    </div>
  );
}

/** Find match washes, from web's ::highlight(t3-thread-find) dark rules (oklch 0.55 0.1 85 / 0.774 0.152 74). */
export function findHighlightColors(theme: ReturnType<typeof useTheme>) {
  return theme.appearance === "dark"
    ? { color: "#8a7434", activeColor: "#e2a33c" }
    : { color: "#f5dd8c", activeColor: "#e2a33c" };
}
