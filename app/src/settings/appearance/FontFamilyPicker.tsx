// Port of apps/web/src/components/settings/FontFamilyPicker.tsx: a searchable list of
// the machine's font families (installedFonts.ts), each drawn in its own face, with
// the default first. Code and terminal fonts must be fixed-width: web measures glyph
// advances on a canvas (appearanceFonts.ts isMonospaceFamily); here the same glyphs
// are laid out off-screen in the candidate family and their widths compared.
import { useGpuixRequired, type KeyEvent } from "@gpuix/react";
import { useRef, useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Popover } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { toast } from "../../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { fieldBackground } from "../controls.tsx";

const DEFAULT_FONT_VALUE = "__default__";
/** `max-h-72`, rows `estimatedItemSize={30}`. */
const LIST_MAX_HEIGHT = 288;
const ROW_HEIGHT = 30;

/** appearanceFonts.ts MONOSPACE_PROBE_GLYPHS (the space is left out: a trailing run of spaces lays out as zero width). */
const PROBE_GLYPHS = ["i", "M", "W", "0", "@", "#", "."] as const;
/** gpuix has no italic, so of web's four variants only the two weights are probed. */
const PROBE_WEIGHTS = [400, 700] as const;
const PROBE_REPEAT = 8;
const MONOSPACE_ADVANCE_TOLERANCE = 0.01;

function MonospaceProbe({ family, onResult }: { family: string; onResult: (monospace: boolean) => void }) {
  const theme = useTheme();
  const widths = useRef(new Map<string, number>());
  const done = useRef(false);
  const total = PROBE_GLYPHS.length * PROBE_WEIGHTS.length;
  return (
    <div style={{ position: "absolute", top: 0, left: 0, opacity: 0, pointerEvents: "none" }}>
      {PROBE_WEIGHTS.flatMap((weight) =>
        PROBE_GLYPHS.map((glyph) => (
          <text
            key={`${weight}:${glyph}`}
            onLayout={(event) => {
              if (done.current || !event.width) return;
              widths.current.set(`${weight}:${glyph}`, event.width);
              if (widths.current.size < total) return;
              done.current = true;
              const monospace = PROBE_WEIGHTS.every((probeWeight) => {
                const advances = PROBE_GLYPHS.map((probeGlyph) => widths.current.get(`${probeWeight}:${probeGlyph}`) ?? 0);
                const reference = advances[0]!;
                return reference > 0 && advances.every((advance) => Math.abs(advance - reference) / reference <= MONOSPACE_ADVANCE_TOLERANCE);
              });
              onResult(monospace);
            }}
            style={{ position: "absolute", top: 0, left: 0, whiteSpace: "nowrap", fontFamily: family, fontWeight: weight, fontSize: 32, color: theme.foreground }}
          >
            {glyph.repeat(PROBE_REPEAT)}
          </text>
        )),
      )}
    </div>
  );
}

export function FontFamilyPicker({
  testId,
  families,
  defaultFamily,
  selectedFamily,
  requireMonospace = false,
  width = 176,
  onSelect,
}: {
  testId?: string;
  families: readonly string[];
  defaultFamily: string;
  selectedFamily: string;
  requireMonospace?: boolean;
  width?: number;
  onSelect: (family: string) => void;
}) {
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [probing, setProbing] = useState<string | null>(null);
  const listRef = useRef<{ id: number } | null>(null);

  const trimmedQuery = query.trim().toLowerCase();
  const items = [
    ...(trimmedQuery.length === 0 ? [DEFAULT_FONT_VALUE] : []),
    ...families.filter((family) => trimmedQuery.length === 0 || family.toLowerCase().includes(trimmedQuery)),
  ];
  const selectedValue = selectedFamily.length === 0 ? DEFAULT_FONT_VALUE : selectedFamily;

  const openPicker = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      setHighlighted(Math.max(0, [DEFAULT_FONT_VALUE, ...families].indexOf(selectedValue)));
    }
  };

  const pick = (value: string | undefined) => {
    if (value === undefined) return;
    setOpen(false);
    if (value !== DEFAULT_FONT_VALUE && requireMonospace) {
      setProbing(value);
      return;
    }
    onSelect(value === DEFAULT_FONT_VALUE ? "" : value);
  };

  const onSearchKeyDown = (event: KeyEvent) => {
    if (event.key !== "up" && event.key !== "down") return;
    event.preventDefault();
    event.stopPropagation();
    if (items.length === 0) return;
    const next = Math.min(items.length - 1, Math.max(0, highlighted + (event.key === "down" ? 1 : -1)));
    setHighlighted(next);
    if (listRef.current) renderer.scrollToItem?.(listRef.current.id, next, 0);
  };

  return (
    <>
      {probing !== null ? (
        <MonospaceProbe
          key={probing}
          family={probing}
          onResult={(monospace) => {
            const family = probing;
            setProbing(null);
            if (monospace) onSelect(family);
            else
              toast({
                type: "error",
                title: `"${family}" isn't monospace`,
                description: "Code and terminal need a fixed-width font, so the current font was kept.",
              });
          }}
        />
      ) : null}
      <Popover
        open={open}
        onOpenChange={openPicker}
        align="end"
        testId={testId ? `${testId}-popup` : undefined}
        style={{ width: 288 }}
        trigger={
          // SelectButton size="sm": the trigger looks like a select.
          <div
            testId={testId}
            onClick={() => openPicker(!open)}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              width,
              height: 28,
              paddingLeft: 9,
              paddingRight: 8,
              borderRadius: RADIUS.lg,
              borderWidth: 1,
              borderColor: theme.input,
              backgroundColor: fieldBackground(theme),
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Text truncate style={{ flexGrow: 1 }}>
              {selectedFamily.length === 0 ? defaultFamily : selectedFamily}
            </Text>
            <Icon name="chevron-down" size={12} color={alpha(theme.foreground, 0.5)} />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 12, height: 36, borderBottomWidth: 1, borderColor: theme.border }}>
          <Icon name="search" size={16} color={alpha(theme.mutedForeground, 0.7)} />
          <input
            testId={testId ? `${testId}-search` : undefined}
            autoFocus
            value={query}
            placeholder="Search fonts…"
            theme={{ caret: theme.foreground }}
            onChange={(event) => {
              setQuery(event.value ?? "");
              setHighlighted(0);
            }}
            onSubmit={() => pick(items[highlighted])}
            onKeyDown={onSearchKeyDown}
            style={{ flexGrow: 1, minWidth: 0, height: 28, fontSize: 14, lineHeight: 28, color: theme.foreground, fontFamily: FONTS.sans }}
          />
        </div>
        {items.length === 0 ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 16, paddingBottom: 16 }}>
            <Text color={theme.mutedForeground}>No fonts found.</Text>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", height: Math.min(items.length * ROW_HEIGHT, LIST_MAX_HEIGHT) + 8, padding: 4 }}>
            <virtual-list ref={listRef as never} estimatedItemHeight={ROW_HEIGHT} style={{ width: "100%", flexGrow: 1, minHeight: 0 }}>
              {items.map((item, index) => {
                const isDefault = item === DEFAULT_FONT_VALUE;
                const family = isDefault ? defaultFamily : item;
                return (
                  <div
                    key={item}
                    testId={testId ? `${testId}-item-${index}` : undefined}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => pick(item)}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      width: "100%",
                      height: ROW_HEIGHT,
                      paddingLeft: 8,
                      paddingRight: 8,
                      borderRadius: RADIUS.sm,
                      cursor: "pointer",
                      ...(index === highlighted ? { backgroundColor: theme.accent } : {}),
                    }}
                  >
                    <text
                      style={{
                        flexShrink: 1,
                        minWidth: 0,
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        fontFamily: family,
                        fontSize: 14,
                        lineHeight: 20,
                        color: index === highlighted ? theme.accentForeground : theme.foreground,
                        pointerEvents: "none",
                      }}
                    >
                      {family}
                    </text>
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0, pointerEvents: "none" }}>
                      {isDefault ? (
                        <Text size="3xs" color={alpha(theme.mutedForeground, 0.6)}>
                          default
                        </Text>
                      ) : null}
                      {item === selectedValue ? <Icon name="check" size={14} color={theme.mutedForeground} /> : null}
                    </div>
                  </div>
                );
              })}
            </virtual-list>
          </div>
        )}
      </Popover>
    </>
  );
}
