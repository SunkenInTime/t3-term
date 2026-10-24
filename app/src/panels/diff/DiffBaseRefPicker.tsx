// The Diff header's comparison-target picker: DiffPanel.tsx's base-ref Combobox
// (ComboboxSearchInput "Search refs...", a Branch / Remote header, an
// "Automatic" entry, one row per ref with a remote switch or a "Remote only"
// mark). Refs come from two listRefs queries (local and remote) that take the
// typed query, so refs past the first 100 are reachable by searching.
import type { EventPayload } from "@gpuix/native";
import { DismissableLayer } from "@gpuix/react";
import { FloatingLayer } from "@gpuix/react/floating";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { vcsEnvironment } from "../../state/git.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip, surfaceStyle } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { buildBaseRefChoices, filterBaseRefChoices, type BaseRefChoice } from "../../web/lib/baseRefChoices.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";

export const AUTOMATIC_BASE_REF = "__automatic_base_ref__";
/** ComboboxPopup className="w-72". */
const POPUP_WIDTH = 288;
/** ComboboxList max-h-64. */
const LIST_MAX_HEIGHT = 256;
const ROW_HEIGHT = 28;

/** The query is sent once typing pauses, like the web combobox's query state settling. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function DiffBaseRefPicker({
  environmentId,
  cwd,
  headRef,
  baseRef,
  selectedBaseRef,
  onSelect,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  headRef: string | null;
  /** The ref the preview compared against (shown on the trigger). */
  baseRef: string;
  /** The user's pick; null is "Automatic". */
  selectedBaseRef: string | null;
  onSelect: (baseRef: string | null) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rowRefs = useRef(new Map<number, { scrollIntoView?: () => void }>());
  const settledQuery = useDebounced(query.trim(), 120);

  const refsInput = (refKind: "local" | "remote") => ({
    environmentId,
    input: {
      cwd,
      includeMatchingRemoteRefs: true,
      refKind,
      ...(settledQuery.length > 0 ? { query: settledQuery } : {}),
      limit: 100,
    },
  });
  const localRefs = useEnvironmentQuery(open ? vcsEnvironment.listRefs(refsInput("local") as never) : null);
  const remoteRefs = useEnvironmentQuery(open ? vcsEnvironment.listRefs(refsInput("remote") as never) : null);
  const choices = buildBaseRefChoices(
    (localRefs.data?.refs ?? []).filter((ref) => ref.name !== headRef),
    remoteRefs.data?.refs ?? [],
  );
  const matching = filterBaseRefChoices(choices, query);
  const valueFor = (choice: BaseRefChoice) =>
    selectedBaseRef && selectedBaseRef === choice.remote?.name
      ? selectedBaseRef
      : (choice.local?.name ?? choice.remote?.name ?? choice.id);
  const items: ReadonlyArray<{ value: string; choice: BaseRefChoice | null }> = [
    { value: AUTOMATIC_BASE_REF, choice: null },
    ...matching.map((choice) => ({ value: valueFor(choice), choice })),
  ];
  const selectedValue = selectedBaseRef ?? AUTOMATIC_BASE_REF;
  const loading = (localRefs.isPending && localRefs.data === null) || (remoteRefs.isPending && remoteRefs.data === null);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const choose = (value: string) => {
    onSelect(value === AUTOMATIC_BASE_REF ? null : value);
    close();
  };
  const toggle = () => {
    if (open) {
      close();
      return;
    }
    setOpen(true);
    setSearchFocused(true);
    // The combobox opens with the current value highlighted.
    setHighlighted(Math.max(0, items.findIndex((item) => item.value === selectedValue)));
  };
  const clampedHighlight = Math.min(highlighted, items.length - 1);
  const moveHighlight = (delta: number) => {
    const next = (clampedHighlight + delta + items.length) % items.length;
    setHighlighted(next);
    rowRefs.current.get(next)?.scrollIntoView?.();
  };

  return (
    <div style={{ display: "flex", position: "relative", alignItems: "center", minWidth: 36, flexShrink: 1 }}>
      <div
        testId="diff-base-ref"
        onClick={toggle}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 24,
          paddingLeft: 7,
          paddingRight: 7,
          borderRadius: RADIUS.md,
          cursor: "pointer",
          minWidth: 36,
          flexShrink: 1,
          backgroundColor: open ? theme.accent : "#00000000",
          hover: { backgroundColor: theme.accent },
        }}
      >
        <Text size="xs" weight={open ? 500 : 400} color={open ? theme.foreground : theme.mutedForeground} truncate style={{ maxWidth: 160 }}>
          {baseRef}
        </Text>
        <Icon name="chevron-down" size={14} color={alpha(open ? theme.foreground : theme.mutedForeground, 0.7)} />
      </div>
      {open ? (
        <DismissableLayer onEscapeKeyDown={close}>
          <FloatingLayer
            side="bottom"
            align="start"
            sideOffset={4}
            testId="diff-base-ref-picker"
            onMouseDownOutside={close}
            style={{ ...surfaceStyle(theme), display: "flex", flexDirection: "column", width: POPUP_WIDTH, overflow: "hidden" }}
          >
            {/* ComboboxSearchInput: px-3 pt-2.5, a bottom rule that turns ring-blue while focused. */}
            <div style={{ flexShrink: 0, paddingTop: 9, paddingLeft: 12, paddingRight: 12 }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingBottom: 6,
                  borderBottomWidth: 1,
                  borderColor: searchFocused ? theme.primary : alpha(theme.border, 0.7),
                }}
              >
                <Icon name="search" size={16} color={alpha(theme.mutedForeground, 0.55)} />
                <input
                  testId="diff-base-ref-search"
                  autoFocus
                  value={query}
                  placeholder="Search refs..."
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  onChange={(event: EventPayload) => {
                    setQuery(String(event.value ?? ""));
                    setHighlighted(0);
                  }}
                  onSubmit={() => {
                    const item = items[clampedHighlight];
                    if (item) choose(item.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "down" || event.key === "up") {
                      event.preventDefault();
                      moveHighlight(event.key === "down" ? 1 : -1);
                    }
                  }}
                  theme={{ caret: theme.foreground }}
                  style={{
                    flexGrow: 1,
                    minWidth: 0,
                    height: 26,
                    lineHeight: 26,
                    color: theme.foreground,
                    fontSize: 14,
                    fontFamily: FONTS.sans,
                    backgroundColor: "#00000000",
                  }}
                />
              </div>
            </div>
            {/* grid-cols-[1rem_minmax(0,1fr)] gap-2 ps-3 pe-6.5 pt-2 pb-1.5 text-3xs uppercase */}
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                flexShrink: 0,
                paddingLeft: 12 + 16 + 8,
                paddingRight: 26,
                paddingTop: 8,
                paddingBottom: 6,
                borderBottomWidth: 1,
                borderColor: alpha(theme.border, 0.7),
              }}
            >
              <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 14, fontWeight: 500, fontFamily: FONTS.sans, flexGrow: 1 }}>
                BRANCH
              </text>
              <text style={{ color: theme.mutedForeground, fontSize: 10, lineHeight: 14, fontWeight: 500, fontFamily: FONTS.sans }}>REMOTE</text>
            </div>
            {items.length <= 1 && query.trim().length > 0 && !loading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
                <Text color={theme.mutedForeground}>No matching refs.</Text>
              </div>
            ) : null}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                maxHeight: LIST_MAX_HEIGHT,
                // A scroller always paints its bar; only scroll when the rows overflow.
                ...(items.length * ROW_HEIGHT + 8 > LIST_MAX_HEIGHT ? { overflowY: "scroll" as const } : {}),
                padding: 4,
                scrollbarColor: theme.scrollbar,
                pointerEvents: "auto",
              }}
            >
              {items.map((item, index) => {
                const choice = item.choice;
                const hasBoth = choice !== null && choice.local !== null && choice.remote !== null;
                const useRemote = choice?.remote?.name === item.value;
                const isSelected = item.value === selectedValue;
                const isHighlighted = index === clampedHighlight;
                return (
                  <div
                    key={choice?.id ?? item.value}
                    ref={((instance: { scrollIntoView?: () => void } | null) => {
                      if (instance) rowRefs.current.set(index, instance);
                      else rowRefs.current.delete(index);
                    }) as never}
                    testId={`diff-base-ref-item-${choice ? choice.label : "automatic"}`}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => {
                      if (!switchJustClicked()) choose(item.value);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      minHeight: ROW_HEIGHT,
                      flexShrink: 0,
                      paddingLeft: 8,
                      paddingRight: 8,
                      borderRadius: RADIUS.sm,
                      cursor: "pointer",
                      backgroundColor: isHighlighted ? theme.accent : isSelected ? alpha(theme.foreground, 0.08) : "#00000000",
                    }}
                  >
                    <text
                      style={{
                        color: theme.foreground,
                        fontSize: 14,
                        lineHeight: 20,
                        fontFamily: FONTS.sans,
                        flexGrow: 1,
                        minWidth: 0,
                        paddingRight: 8,
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        pointerEvents: "none",
                      }}
                    >
                      {choice ? choice.label : "Automatic"}
                    </text>
                    {hasBoth ? (
                      <div style={{ display: "flex", justifyContent: "flex-end", width: 32, flexShrink: 0 }}>
                        <SmallSwitch
                          testId={`diff-base-ref-remote-${choice.label}`}
                          checked={useRemote}
                          onChange={(checked) => {
                            const next = checked ? choice.remote?.name : choice.local?.name;
                            if (next) choose(next);
                          }}
                        />
                      </div>
                    ) : choice?.remote ? (
                      <Tooltip content="Remote only" side="top">
                        <div style={{ display: "flex", justifyContent: "flex-end", width: 32, flexShrink: 0 }}>
                          <Icon name="check" size={12} color={theme.mutedForeground} />
                        </div>
                      </Tooltip>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </FloatingLayer>
        </DismissableLayer>
      ) : null}
    </div>
  );
}

// gpuix hands a click to every handler under the pointer: the switch marks its
// click so the row under it does not also pick the local ref.
let switchClickAt = 0;

/** Switch with `[--thumb-size:--spacing(3)]`: a 22×14 track. */
function SmallSwitch({ checked, onChange, testId }: { checked: boolean; onChange: (checked: boolean) => void; testId: string }) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onMouseDown={() => {
        switchClickAt = Date.now();
        onChange(!checked);
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        width: 22,
        height: 14,
        padding: 2,
        borderRadius: 7,
        backgroundColor: checked ? theme.primary : theme.input,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: !checked && theme.appearance === "dark" ? theme.mutedForeground : theme.background,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function switchJustClicked(): boolean {
  return Date.now() - switchClickAt < 400;
}
