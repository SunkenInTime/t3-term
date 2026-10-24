// apps/web/src/components/chat/ThreadFindBar.tsx. The search lifecycle is
// useThreadFind.ts (web's hook); it lives in the bar so typing re-renders only
// the bar, the way web's ThreadFindProvider keeps it off the chat view. The
// timeline opens the fold that holds the active match, pages history toward
// it, scrolls to the occurrence, and gpuix's native `highlight` paints matches.
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { InlineSkill } from "@t3tools/shared/inlineSkills";
import { useEffect, useState, type RefObject } from "react";

import { serverEnvironment } from "../../state/environment.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { FONTS, RADIUS, useTheme } from "../../ui/theme.ts";
import { formatThreadFindCount, type ThreadFindPositionReader } from "../../web/components/chat/threadFind.ts";
import { useThreadFind } from "./useThreadFind.ts";

export interface ThreadFindState {
  readonly query: string;
  readonly match: { readonly entryId: string; readonly occurrence: number } | null;
  /** Bumps on every navigation, so the timeline scrolls even when the match repeats. */
  readonly navigationId: number;
}

/**
 * Splits a textarea edit into the query and a Shift+Enter. gpuix's single-line
 * input swallows Shift+Enter (a no-op Newline binding) and its submit event
 * carries no modifiers, so the field is a one-row textarea: Enter submits, and
 * Shift+Enter arrives as one inserted newline. Pasted newlines become spaces,
 * as a browser search field strips them.
 */
export function splitFindInput(previous: string, next: string): { query: string; previousMatch: boolean } {
  const index = next.indexOf("\n");
  if (index >= 0 && next.length === previous.length + 1 && next.slice(0, index) + next.slice(index + 1) === previous) {
    return { query: previous, previousMatch: true };
  }
  return { query: next.replace(/\r?\n/g, " ").slice(0, 200), previousMatch: false };
}

export function ThreadFindBar({
  threadRef,
  skills,
  positionReader,
  onChange,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  skills: readonly InlineSkill[];
  positionReader: RefObject<ThreadFindPositionReader | null>;
  onChange: (state: ThreadFindState) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const find = useThreadFind({ thread: threadRef, progressive: config?.threadFindProgressive === true, skills, positionReader });
  const bar = find.barProps;
  const { findQuery, activeFindMatch, findNavigationId } = find.timeline;
  // The textarea keeps its own text; resetting `value` after a Shift+Enter puts it back.
  const [fieldValue, setFieldValue] = useState(bar.query);

  useEffect(() => {
    onChange({
      query: findQuery,
      match: activeFindMatch ? { entryId: activeFindMatch.entryId, occurrence: activeFindMatch.occurrence } : null,
      navigationId: findNavigationId,
    });
    // onChange is stable in the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQuery, activeFindMatch?.entryId, activeFindMatch?.occurrence, findNavigationId]);

  const hasQuery = bar.query.trim().length > 0;
  const noResults = hasQuery && !bar.status && bar.matchCount === 0;
  let label = hasQuery ? (bar.counting ? "1/…" : formatThreadFindCount(bar.activeIndex, bar.matchCount)) : "";
  if (bar.status === "loading") label = "Searching…";
  if (bar.status === "error") label = "Search failed";
  const navigationDisabled = bar.matchCount === 0 || bar.status === "loading" || bar.counting;

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
      <textarea
        testId="thread-find-input"
        autoFocus
        value={fieldValue}
        placeholder="Find in thread"
        minRows={1}
        maxRows={1}
        onChange={(event) => {
          const raw = event.value ?? "";
          const next = splitFindInput(bar.query, raw);
          if (next.previousMatch) {
            // Commit the field's own text first so the next `value` differs and replaces it.
            setFieldValue(raw);
            setTimeout(() => setFieldValue(next.query), 0);
            bar.onPrevious();
            return;
          }
          setFieldValue(next.query === raw ? raw : next.query);
          if (next.query !== bar.query) bar.onQueryChange(next.query);
        }}
        onSubmit={() => bar.onNext()}
        onKeyDown={(event) => {
          if (event.key === "escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 20, fontSize: 14, lineHeight: 20, fontFamily: FONTS.sans, color: theme.foreground }}
      />
      <div style={{ display: "flex", justifyContent: "center", minWidth: 40, flexShrink: 0 }}>
        <text style={{ color: noResults ? theme.errorForeground : theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>
          {label}
        </text>
      </div>
      {bar.status === "error" ? (
        <div
          testId="thread-find-retry"
          onClick={bar.onRetry}
          style={{ display: "flex", alignItems: "center", height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: RADIUS.md, cursor: "pointer", flexShrink: 0, hover: { backgroundColor: theme.accent } }}
        >
          <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans, fontWeight: 500 }}>Retry</text>
        </div>
      ) : null}
      {iconButton("chevron-up", bar.onPrevious, navigationDisabled, "thread-find-previous")}
      {iconButton("chevron-down", bar.onNext, navigationDisabled, "thread-find-next")}
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
