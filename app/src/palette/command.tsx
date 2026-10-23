// Palette primitives: port of apps/web/src/components/ui/command.tsx,
// CommandPaletteContent.tsx and CommandPaletteResults.tsx.
//   popup: dialog-glass, radius 18 (rounded-2xl), max-w 576 (max-w-xl), max-h 420, 10vh from top
//   input row: py 6 px 8, 36px input, Search icon 16 icon-muted
//   list: py 8 px 8; heading px 8 py 6 12px medium muted; item min-h 28 py 6 px 8 radius 6, gap 8
//   footer: bg fg 2.5%, py 10 px 16, 14px medium muted, kbd bg fg 8% fg text
import { useGpuixRequired, useWindowSize } from "@gpuix/react";
import * as DialogPrimitive from "@gpuix/react/dialog";
import type { KeyEvent } from "@gpuix/react";
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { memo, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { Icon, type IconName } from "../ui/Icon.tsx";
import { dialogGlassShadow } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme, type Palette } from "../ui/theme.ts";
import { useSmallViewport } from "../ui/viewport.tsx";
import type {
  CommandPaletteActionItem,
  CommandPaletteRow,
  CommandPaletteSubmenuItem,
} from "../web/components/CommandPalette.logic.ts";
import { shortcutLabelForCommand } from "../web/keybindings.ts";

export type PaletteItem = CommandPaletteActionItem | CommandPaletteSubmenuItem;

const POPUP_WIDTH = 576;
const POPUP_MAX_HEIGHT = 420;

export function paletteSurface(theme: Palette) {
  return {
    background: theme.appearance === "dark" ? "#090909" : theme.background,
    border: theme.appearance === "dark" ? alpha("#ffffff", 0.08) : alpha(theme.foreground, 0.1),
  };
}

/** The dialog: dimmed backdrop and the popup 10vh from the top. */
export function PaletteFrame({
  onClose,
  height,
  initialFocus,
  children,
  testId = "command-palette",
}: {
  onClose: () => void;
  /** Fixed height (content search uses h-105); otherwise the popup hugs its content. */
  height?: number;
  initialFocus?: RefObject<{ id: number } | null>;
  children: ReactNode;
  testId?: string;
}) {
  const theme = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const small = useSmallViewport();
  const surface = paletteSurface(theme);
  // CommandDialogViewport: `px-4 py-[max(--spacing(4),4vh)] sm:py-[10vh]`, and the popup
  // shrinks to fit between those paddings.
  const viewportHeight = windowHeight || 900;
  const top = small ? Math.max(16, Math.round(viewportHeight * 0.04)) : Math.max(16, Math.round(viewportHeight * 0.1));
  const fitHeight = Math.max(0, viewportHeight - top * 2);
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* The layer lays out as a column: center across, start down. */}
      <DialogPrimitive.Portal style={{ flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingTop: top }}>
        <DialogPrimitive.Backdrop style={{ backgroundColor: theme.overlay, pointerEvents: "auto" }} />
        <DialogPrimitive.Popup
          testId={testId}
          {...(initialFocus ? { initialFocus: initialFocus as never } : {})}
          style={{
            display: "flex",
            flexDirection: "column",
            width: Math.min(POPUP_WIDTH, Math.max(0, (windowWidth || 1440) - 32)),
            ...(height === undefined ? { maxHeight: Math.min(POPUP_MAX_HEIGHT, fitHeight) } : { height: Math.min(height, fitHeight) }),
            borderRadius: RADIUS["2xl"],
            borderWidth: 1,
            borderColor: surface.border,
            backgroundColor: surface.background,
            boxShadow: dialogGlassShadow(theme),
            overflow: "hidden",
          }}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** CommandInput: a borderless 36px input behind a leading icon or back button. */
export function PaletteInput({
  value,
  placeholder,
  onChange,
  onKeyDown,
  onSubmit,
  leading = "search",
  onBack,
  onBackspaceWhenEmpty,
  accessory,
  accessoryWidth = 0,
  disabled,
  inputRef,
  testId = "command-palette-input",
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyEvent) => void;
  onSubmit?: () => void;
  leading?: "search" | "back" | IconName;
  onBack?: () => void;
  /** Backspace on an already empty query (web: steps back out of a submenu). */
  onBackspaceWhenEmpty?: () => void;
  accessory?: ReactNode;
  accessoryWidth?: number;
  disabled?: boolean;
  inputRef?: RefObject<{ id: number } | null>;
  testId?: string;
}) {
  const theme = useTheme();
  const icon: IconName = leading === "search" ? "search" : leading === "back" ? "arrow-left" : leading;
  // The input runs Backspace as an editing action, so onKeyDown never sees it; the
  // key-up still arrives. A Backspace that changed nothing found the query empty.
  const editedSinceKeyUp = useRef(false);
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", paddingTop: 6, paddingBottom: 6, paddingLeft: 8, paddingRight: 8, flexShrink: 0 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          flexGrow: 1,
          height: 36,
          opacity: disabled ? 0.64 : 1,
        }}
      >
        <div
          testId={leading === "back" ? "command-palette-back" : undefined}
          onClick={leading === "back" ? onBack : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 36,
            paddingLeft: 2,
            flexShrink: 0,
            cursor: leading === "back" ? "pointer" : "default",
          }}
        >
          <Icon name={icon} size={16} color={leading === "back" ? theme.foreground : theme.mutedForeground} />
        </div>
        <input
          ref={inputRef as never}
          testId={testId}
          autoFocus
          value={value}
          placeholder={placeholder}
          readOnly={disabled}
          theme={{ caret: theme.foreground }}
          onChange={(event) => {
            editedSinceKeyUp.current = true;
            onChange(event.value ?? "");
          }}
          onSubmit={() => onSubmit?.()}
          onKeyDown={onKeyDown}
          onKeyUp={(event) => {
            const edited = editedSinceKeyUp.current;
            editedSinceKeyUp.current = false;
            if (event.key === "backspace" && !edited && value === "") onBackspaceWhenEmpty?.();
          }}
          style={{
            flexGrow: 1,
            height: 34,
            minWidth: 0,
            paddingLeft: 1,
            paddingRight: 8 + accessoryWidth,
            fontSize: 14,
            lineHeight: 20,
            fontFamily: FONTS.sans,
            color: theme.foreground,
          }}
        />
      </div>
      {accessory}
    </div>
  );
}

export function PaletteKbd({ children, icon }: { children?: string; icon?: IconName }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 20,
        minWidth: 20,
        paddingLeft: 4,
        paddingRight: 4,
        borderRadius: 4,
        backgroundColor: alpha(theme.foreground, 0.08),
        flexShrink: 0,
      }}
    >
      {icon ? <Icon name={icon} size={12} color={theme.foreground} /> : null}
      {children ? (
        <Text size="xs" weight={500} color={theme.foreground}>
          {children}
        </Text>
      ) : null}
    </div>
  );
}

function KbdGroup({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>{children}</div>;
}

/** CommandFooter with the hint row. */
export function PaletteFooter({
  actionLabel = "Select",
  escapeLabel = "Close",
  backHint,
  trailing,
}: {
  actionLabel?: string | null;
  escapeLabel?: string;
  /** Submenus: the Backspace hint shown before Esc (web "Backspace Back · Esc Close"). */
  backHint?: string | null;
  trailing?: ReactNode;
}) {
  const theme = useTheme();
  // CommandPaletteContent: `max-sm:flex-col max-sm:items-start`.
  const small = useSmallViewport();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: small ? "column" : "row",
        alignItems: small ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: 8,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 16,
        paddingRight: 16,
        backgroundColor: alpha(theme.foreground, 0.025),
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
        <KbdGroup>
          <PaletteKbd icon="arrow-up" />
          <PaletteKbd icon="arrow-down" />
          <Text weight={500} color={theme.mutedForeground}>
            Navigate
          </Text>
        </KbdGroup>
        {actionLabel ? (
          <KbdGroup>
            <PaletteKbd>Enter</PaletteKbd>
            <Text weight={500} color={theme.mutedForeground}>
              {actionLabel}
            </Text>
          </KbdGroup>
        ) : null}
        {backHint ? (
          <KbdGroup>
            <PaletteKbd>Backspace</PaletteKbd>
            <Text weight={500} color={theme.mutedForeground}>
              {backHint}
            </Text>
          </KbdGroup>
        ) : null}
        <KbdGroup>
          <PaletteKbd>Esc</PaletteKbd>
          <Text weight={500} color={theme.mutedForeground}>
            {escapeLabel}
          </Text>
        </KbdGroup>
      </div>
      {trailing}
    </div>
  );
}

/** Scrolling results region (CommandPanel + list padding). */
/**
 * Rows must be direct children: gpuix's scrollIntoView scrolls the scroller to
 * the direct child that contains the target.
 */
export function PalettePanel({ children, fill, padding }: { children: ReactNode; fill?: boolean; padding?: { y: number; x: number } }) {
  const theme = useTheme();
  return (
    <div
      testId="command-palette-results"
      style={{
        display: "flex",
        flexDirection: "column",
        ...(padding ? { paddingTop: padding.y, paddingBottom: padding.y, paddingLeft: padding.x, paddingRight: padding.x } : {}),
        flexGrow: fill ? 1 : 0,
        flexShrink: 1,
        minHeight: 0,
        overflowY: "scroll",
        scrollbarColor: theme.scrollbar,
        scrollbarWidth: 6,
      }}
    >
      {children}
    </div>
  );
}

export function PaletteEmptyState({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 40, paddingBottom: 40, paddingLeft: 16, paddingRight: 16 }}>
      <Text color={theme.mutedForeground} style={{ textAlign: "center" }}>
        {message}
      </Text>
    </div>
  );
}

export function PaletteNotice({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <div style={{ paddingTop: 12, paddingBottom: 12, paddingLeft: 16, paddingRight: 16, flexShrink: 0 }}>
      <Text color={theme.mutedForeground}>{message}</Text>
    </div>
  );
}

function renderTitle(title: ReactNode, color: string) {
  return typeof title === "string" ? (
    <Text color={color} truncate>
      {title}
    </Text>
  ) : (
    title
  );
}

const PaletteRowView = memo(function PaletteRowView({
  item,
  active,
  disabled,
  shortcutLabel,
  onExecute,
  onHover,
  rowRef,
}: {
  item: PaletteItem;
  active: boolean;
  disabled: boolean;
  shortcutLabel: string | null;
  onExecute: (item: PaletteItem) => void;
  onHover: (value: string) => void;
  rowRef?: (instance: { scrollIntoView?: () => void } | null) => void;
}) {
  const theme = useTheme();
  const hasSecondLine = item.description !== undefined || item.threadContentMatch !== undefined;
  return (
    <div
      ref={rowRef as never}
      testId={`palette-item-${item.value}`}
      onClick={disabled ? undefined : () => onExecute(item)}
      onMouseEnter={disabled ? undefined : () => onHover(item.value)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: hasSecondLine ? "flex-start" : "center",
        gap: 8,
        minHeight: 28,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        backgroundColor: active ? theme.accent : "#00000000",
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", height: 20, flexShrink: 0, pointerEvents: "none" }}>{item.icon}</div>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, pointerEvents: "none" }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0, height: 20 }}>
          {item.titleLeadingContent}
          {renderTitle(item.title, theme.foreground)}
        </div>
        {item.threadContentMatch ? (
          <Text size="xs" color={alpha(theme.mutedForeground, 0.9)} truncate>
            {item.threadContentMatch.snippet}
          </Text>
        ) : null}
        {item.description !== undefined ? (
          typeof item.description === "string" ? (
            <Text size="xs" color={alpha(theme.mutedForeground, 0.7)} style={{ minWidth: 0 }}>
              {item.description}
            </Text>
          ) : (
            item.description
          )
        ) : null}
      </div>
      {item.titleTrailingContent ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 20, flexShrink: 0 }}>
          {item.titleTrailingContent}
        </div>
      ) : null}
      {item.timestamp ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", minWidth: 48, height: 20, flexShrink: 0, pointerEvents: "none" }}>
          <Text size="xs" color={alpha(theme.mutedForeground, 0.7)}>
            {item.timestamp}
          </Text>
        </div>
      ) : null}
      {shortcutLabel ? (
        <div style={{ display: "flex", alignItems: "center", height: hasSecondLine ? undefined : 20, alignSelf: "center", flexShrink: 0, pointerEvents: "none" }}>
          <Text size="xs" weight={500} color={theme.mutedForeground}>
            {shortcutLabel}
          </Text>
        </div>
      ) : null}
      {item.kind === "submenu" ? (
        <div style={{ display: "flex", alignItems: "center", height: 20, marginRight: -2, flexShrink: 0, pointerEvents: "none" }}>
          <Icon name="chevron-right" size={16} color={alpha(theme.mutedForeground, 0.7)} />
        </div>
      ) : null}
    </div>
  );
});

type PaletteRowsProps = {
  rows: ReadonlyArray<CommandPaletteRow>;
  highlightedValue: string | null;
  keybindings: ResolvedKeybindingsConfig;
  onExecute: (item: PaletteItem) => void;
  onHighlight: (value: string) => void;
  /** Bumped when the keyboard moves the highlight. */
  scrollToHighlight: number;
  emptyMessage: string;
  limit?: number;
};

// Lists up to this long render as plain rows and hug their content; longer ones
// fill the popup's max height anyway, so they go on a windowed virtual list.
// gpuix builds every child of a plain scroller each frame: 300 thread rows were
// about 3,700 elements and 100+ ms per frame while typing a query.
const PLAIN_ROW_LIMIT = 24;
const ROW_WINDOW = 48;
const ITEM_HEIGHT = 32;
const TWO_LINE_ITEM_HEIGHT = 48;

/**
 * CommandPaletteVirtualizedResults: headings and items. Keyboard highlight
 * scrolls its row into view. Rows past `limit` are not built; the palette
 * narrows long lists by typing, like web's virtualized list makes them cheap.
 */
export function PaletteRows(props: PaletteRowsProps) {
  const rows = props.rows.slice(0, props.limit ?? 300);
  if (rows.length === 0) return <PaletteEmptyState message={props.emptyMessage} />;
  return rows.length > PLAIN_ROW_LIMIT ? <VirtualPaletteRows {...props} rows={rows} /> : <PlainPaletteRows {...props} rows={rows} />;
}

function PaletteRowContent({
  row,
  highlightedValue,
  keybindings,
  onExecute,
  onHighlight,
  rowRef,
}: Pick<PaletteRowsProps, "highlightedValue" | "keybindings" | "onExecute" | "onHighlight"> & {
  row: CommandPaletteRow;
  rowRef?: ((instance: { scrollIntoView?: () => void } | null) => void) | undefined;
}) {
  const theme = useTheme();
  return row.kind === "label" ? (
    <div style={{ paddingTop: row.first ? 0 : 6, flexShrink: 0 }}>
      <div style={{ paddingTop: 6, paddingBottom: 6, paddingLeft: 8, paddingRight: 8 }}>
        <Text size="xs" weight={500} color={theme.mutedForeground}>
          {row.label}
        </Text>
      </div>
    </div>
  ) : (
    <PaletteRowView
      item={row.item}
      active={row.itemIndex !== null && highlightedValue === row.item.value}
      disabled={row.itemIndex === null}
      shortcutLabel={
        row.itemIndex !== null && row.item.shortcutCommand ? shortcutLabelForCommand(keybindings, row.item.shortcutCommand) : null
      }
      onExecute={onExecute}
      onHover={onHighlight}
      {...(rowRef ? { rowRef } : {})}
    />
  );
}

function PlainPaletteRows(props: PaletteRowsProps) {
  const { rows, highlightedValue, scrollToHighlight } = props;
  const rowRefs = useRef(new Map<string, { scrollIntoView?: () => void }>());
  useEffect(() => {
    if (highlightedValue === null) return;
    rowRefs.current.get(highlightedValue)?.scrollIntoView?.();
  }, [scrollToHighlight]);
  return (
    <PalettePanel padding={{ y: 8, x: 8 }}>
      {rows.map((row) => (
        <PaletteRowContent
          key={row.key}
          row={row}
          highlightedValue={highlightedValue}
          keybindings={props.keybindings}
          onExecute={props.onExecute}
          onHighlight={props.onHighlight}
          rowRef={
            row.kind === "label"
              ? undefined
              : (instance) => {
                  if (instance) rowRefs.current.set(row.item.value, instance);
                  else rowRefs.current.delete(row.item.value);
                }
          }
        />
      ))}
    </PalettePanel>
  );
}

function estimatedRowHeight(row: CommandPaletteRow): number {
  if (row.kind === "label") return (row.first ? 0 : 6) + 28;
  return row.item.description !== undefined || row.item.threadContentMatch !== undefined ? TWO_LINE_ITEM_HEIGHT : ITEM_HEIGHT;
}

/**
 * The same rows on a windowed virtual list. The list's 8px top and bottom
 * padding are spacer items so they scroll away like the plain list's padding.
 * The panel asks for the rows' estimated height and shrinks to the popup's
 * max height, as the plain scroller does.
 */
function VirtualPaletteRows(props: PaletteRowsProps) {
  const { rows, highlightedValue, scrollToHighlight } = props;
  const theme = useTheme();
  const renderer = useGpuixRequired();
  const listRef = useRef<{ id: number } | null>(null);
  const visible = useRef({ start: 0, end: 0 });
  const [windowStart, setWindowStart] = useState(0);
  // Item 0 is the top spacer; row i is item i + 1.
  const itemCount = rows.length + 2;
  useEffect(() => {
    setWindowStart(0);
    const id = listRef.current?.id;
    if (id !== undefined) renderer.scrollToItem?.(id, 0, 0);
  }, [rows.length, rows[0]?.key, renderer]);
  useEffect(() => {
    if (highlightedValue === null) return;
    const rowIndex = rows.findIndex((row) => row.kind !== "label" && row.item.value === highlightedValue);
    const id = listRef.current?.id;
    if (rowIndex < 0 || id === undefined) return;
    const index = rowIndex + 1;
    if (index < windowStart || index >= windowStart + ROW_WINDOW) setWindowStart(Math.max(0, index - ROW_WINDOW / 2));
    // scrollIntoView "nearest": top-align a row above the viewport, bottom-align one below it.
    if (index <= visible.current.start) {
      renderer.scrollToItem?.(id, index === 1 ? 0 : index, 0);
    } else if (index >= visible.current.end - 1) {
      const viewport = renderer.getListScrollTop?.(id)?.[2] ?? 0;
      renderer.scrollToItem?.(id, index, -(viewport - estimatedRowHeight(rows[rowIndex]!) - 8));
    }
  }, [scrollToHighlight]);
  const end = Math.min(itemCount, windowStart + ROW_WINDOW);
  const items: ReactNode[] = [];
  for (let index = windowStart; index < end; index += 1) {
    if (index === 0 || index === itemCount - 1) {
      items.push(<div key={index === 0 ? "palette-top" : "palette-bottom"} style={{ height: 8 }} />);
      continue;
    }
    const row = rows[index - 1]!;
    items.push(
      <div key={row.key} style={{ display: "flex", flexDirection: "column", width: "100%", paddingLeft: 8, paddingRight: 8 }}>
        <PaletteRowContent
          row={row}
          highlightedValue={highlightedValue}
          keybindings={props.keybindings}
          onExecute={props.onExecute}
          onHighlight={props.onHighlight}
        />
      </div>,
    );
  }
  const estimatedHeight = rows.reduce((sum, row) => sum + estimatedRowHeight(row), 16);
  return (
    <div
      testId="command-palette-results"
      style={{ display: "flex", flexDirection: "column", width: "100%", height: estimatedHeight, flexShrink: 1, minHeight: 0 }}
    >
      <virtual-list
        ref={listRef as never}
        itemCount={itemCount}
        windowStart={windowStart}
        estimatedItemHeight={ITEM_HEIGHT}
        onVisibleRange={(event) => {
          const start = Math.floor(event.startIndex ?? 0);
          visible.current = { start, end: Math.ceil(event.endIndex ?? start) };
          if (start < windowStart || start + ROW_WINDOW / 2 > windowStart + ROW_WINDOW) setWindowStart(Math.max(0, start - ROW_WINDOW / 4));
        }}
        style={{ width: "100%", flexGrow: 1, minHeight: 0, scrollbarColor: theme.scrollbar, scrollbarWidth: 6 }}
      >
        {items}
      </virtual-list>
    </div>
  );
}

/** ITEM_ICON_CLASS: size-4 text-icon-muted. */
export function ItemIcon({ name, color }: { name: IconName; color?: string }) {
  const theme = useTheme();
  return <Icon name={name} size={16} color={color ?? theme.mutedForeground} />;
}

/** CommandPaletteSubmitButton: an outline xs button with the shortcut in a Kbd. */
export function PaletteSubmitButton({
  label,
  shortcutLabel,
  disabled,
  onSubmit,
}: {
  label: string;
  shortcutLabel: string;
  disabled?: boolean;
  onSubmit: () => void;
}) {
  const theme = useTheme();
  const dark = theme.appearance === "dark";
  return (
    <div
      testId="command-palette-submit"
      onClick={disabled ? undefined : onSubmit}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 24,
        paddingLeft: 7,
        paddingRight: 4,
        marginRight: 2,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: dark ? alpha("#ffffff", 0.026) : theme.popover,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(disabled ? {} : { hover: { backgroundColor: dark ? alpha("#ffffff", 0.05) : theme.accent } }),
      }}
    >
      <Text size="xs" weight={500}>
        {label}
      </Text>
      <div style={{ display: "flex", alignItems: "center", height: 18, paddingLeft: 4, paddingRight: 4, borderRadius: 4, backgroundColor: theme.muted }}>
        <Text size="xs" weight={500} color={theme.mutedForeground}>
          {shortcutLabel}
        </Text>
      </div>
    </div>
  );
}
