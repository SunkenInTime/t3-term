// Floating UI styled after apps/web/src/components/ui/{menu,popover,select,dialog,tooltip}.tsx.
// Everything that paints above content goes through gpuix's deferred <anchored>
// layer (FloatingLayer / Dialog.Portal); an absolutely positioned div would paint
// under any later <virtual-list>.
import { useAtomValue } from "@effect/atom-react";
import { DismissableLayer } from "@gpuix/react";
import { FloatingLayer, type FloatingAlign, type FloatingSide } from "@gpuix/react/floating";
import * as DialogPrimitive from "@gpuix/react/dialog";
import * as TooltipPrimitive from "@gpuix/react/tooltip";
import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { Icon, type IconName } from "./Icon.tsx";
import { Kbd, Text, type Style } from "./primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme, type Palette } from "./theme.ts";
import { useSmallViewport, viewportWidthAtom } from "./viewport.tsx";

/** dropdown-glass: popover at ~84% over a blurred backdrop. GPUI has no backdrop blur, so it is opaque. */
export function surfaceStyle(theme: Palette): Style {
  return {
    backgroundColor: theme.appearance === "dark" ? "#141414" : "#ffffff",
    borderWidth: 1,
    borderColor: alpha(theme.foreground, 0.1),
    borderRadius: RADIUS.lg,
    boxShadow: { offsetX: 0, offsetY: 16, blurRadius: 40, spreadRadius: -18, color: "#0000008c" },
  };
}

/**
 * dialog-glass box-shadow: light `0 24px 64px -24px rgb(0 0 0 / 65%)`, dark
 * `0 24px 72px -20px rgb(0 0 0 / 90%)`. GPUI's blur spreads about twice as far
 * as CSS's, so the blur radii are halved.
 */
export function dialogGlassShadow(theme: Palette): Style["boxShadow"] {
  return theme.appearance === "dark"
    ? { offsetX: 0, offsetY: 24, blurRadius: 36, spreadRadius: -20, color: "#000000e6" }
    : { offsetX: 0, offsetY: 24, blurRadius: 32, spreadRadius: -24, color: "#000000a6" };
}

// ── Popover ─────────────────────────────────────────────────────────────

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element the popover anchors to. */
  trigger: ReactNode;
  children: ReactNode;
  side?: FloatingSide;
  align?: FloatingAlign;
  sideOffset?: number;
  alignOffset?: number;
  style?: Style;
  /** Trigger wrapper style. */
  rootStyle?: Style;
  testId?: string;
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  alignOffset = 0,
  style,
  rootStyle,
  testId,
}: PopoverProps) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", position: "relative", alignItems: "center", ...rootStyle }}>
      {trigger}
      {open ? (
        <DismissableLayer onEscapeKeyDown={() => onOpenChange(false)}>
          <FloatingLayer
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            testId={testId}
            onMouseDownOutside={() => onOpenChange(false)}
            style={{ ...surfaceStyle(theme), display: "flex", flexDirection: "column", ...style }}
          >
            {children}
          </FloatingLayer>
        </DismissableLayer>
      ) : null}
    </div>
  );
}

// ── Menu ────────────────────────────────────────────────────────────────

interface MenuContextValue {
  close: () => void;
}
const MenuContext = createContext<MenuContextValue>({ close: () => {} });

/** A dropdown menu: Popover + rows that close it on select. */
export function Menu({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  minWidth = 160,
  maxHeight,
  testId,
  rootStyle,
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: FloatingSide;
  align?: FloatingAlign;
  sideOffset?: number;
  minWidth?: number;
  maxHeight?: number;
  testId?: string;
  rootStyle?: Style;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );
  const context = useMemo(() => ({ close: () => setOpen(false) }), [setOpen]);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side={side}
      align={align}
      sideOffset={sideOffset}
      testId={testId}
      rootStyle={rootStyle}
      style={{ padding: 4, minWidth, ...(maxHeight ? { maxHeight, overflowY: "scroll" } : {}) }}
      trigger={trigger({ open, toggle: () => setOpen(!open) })}
    >
      <MenuContext.Provider value={context}>{children}</MenuContext.Provider>
    </Popover>
  );
}

export function MenuItem({
  children,
  icon,
  shortcut,
  checked,
  destructive,
  disabled,
  description,
  trailing,
  onSelect,
  keepOpen,
  testId,
}: {
  children: ReactNode;
  icon?: IconName;
  shortcut?: string;
  checked?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  description?: string;
  trailing?: ReactNode;
  onSelect?: () => void;
  keepOpen?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  const { close } = useContext(MenuContext);
  const color = destructive ? theme.errorForeground : theme.foreground;
  // menu.tsx below `sm`: `min-h-8 text-base`, icons size-4.5 (sm: min-h-7 text-sm size-4).
  const small = useSmallViewport();
  return (
    <div
      testId={testId}
      onClick={
        disabled
          ? undefined
          : () => {
              onSelect?.();
              if (!keepOpen) close();
            }
      }
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: description ? "flex-start" : "center",
        gap: 8,
        minHeight: small ? 32 : 28,
        paddingTop: description ? 6 : 0,
        paddingBottom: description ? 6 : 0,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.sm,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
      }}
    >
      {icon ? (
        <Icon name={icon} size={small ? 18 : 16} color={destructive ? theme.errorForeground : theme.mutedForeground} />
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <Text size={small ? "base" : "sm"} color={color} truncate>
          {children}
        </Text>
        {description ? (
          <Text size="xs" color={theme.mutedForeground}>
            {description}
          </Text>
        ) : null}
      </div>
      {trailing}
      {shortcut ? (
        <Text size="xs" color={alpha(theme.mutedForeground, 0.8)}>
          {shortcut}
        </Text>
      ) : null}
      {checked ? <Icon name="check" size={16} color={theme.foreground} /> : null}
    </div>
  );
}

export function MenuSeparator() {
  const theme = useTheme();
  return <div style={{ height: 1, marginTop: 4, marginBottom: 4, marginLeft: -4, marginRight: -4, backgroundColor: theme.border, flexShrink: 0 }} />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 4, flexShrink: 0 }}>
      <Text size="xs" weight={500} color={theme.mutedForeground}>
        {children}
      </Text>
    </div>
  );
}

// ── Select (a Menu with a value) ────────────────────────────────────────

export interface SelectOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconName;
}

/** apps/web/src/components/ui/select.tsx trigger: min-h 32, radius 10, border input, chevron. */
export function Select<V extends string>({
  value,
  options,
  onChange,
  minWidth = 144,
  testId,
  align = "end",
}: {
  value: V;
  options: ReadonlyArray<SelectOption<V>>;
  onChange: (value: V) => void;
  minWidth?: number;
  testId?: string;
  align?: FloatingAlign;
}) {
  const theme = useTheme();
  const selected = options.find((option) => option.value === value);
  // select.tsx trigger below `sm`: `min-h-9 text-base`.
  const small = useSmallViewport();
  return (
    <Menu
      align={align}
      minWidth={minWidth}
      testId={testId ? `${testId}-menu` : undefined}
      trigger={({ toggle }) => (
        <div
          testId={testId}
          onClick={toggle}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minHeight: small ? 36 : 32,
            minWidth,
            paddingLeft: 11,
            paddingRight: 8,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: theme.appearance === "dark" ? alpha(theme.input, 0.32) : theme.background,
            cursor: "pointer",
          }}
        >
          {selected?.icon ? <Icon name={selected.icon} size={16} color={theme.mutedForeground} /> : null}
          <Text size={small ? "base" : "sm"} truncate style={{ flexGrow: 1 }}>
            {selected?.label ?? value}
          </Text>
          <Icon name="chevron-down" size={16} color={theme.mutedForeground} />
        </div>
      )}
    >
      {options.map((option) => (
        <MenuItem
          key={option.value}
          icon={option.icon}
          description={option.description}
          checked={option.value === value}
          onSelect={() => onChange(option.value)}
        >
          {option.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

// ── Switch ──────────────────────────────────────────────────────────────

/** apps/web/src/components/ui/switch.tsx: 30×18 track, 14px thumb. */
export function Switch({
  checked,
  onChange,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : () => onChange(!checked)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        width: 30,
        height: 18,
        padding: 2,
        borderRadius: 9,
        backgroundColor: checked ? theme.primary : theme.input,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          // bg-background, dark:data-unchecked:bg-muted-foreground: a checked dark
          // switch has a dark thumb, not a white one.
          backgroundColor: !checked && theme.appearance === "dark" ? theme.mutedForeground : theme.background,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ── Dialog ──────────────────────────────────────────────────────────────

/**
 * Children in reverse order, looking through one fragment: DialogFooter's
 * `flex-col-reverse` below `sm` (gpuix lays out `column-reverse` as a row).
 */
export function reversedChildren(children: ReactNode): ReactNode[] {
  const items = Children.toArray(children);
  const only = items.length === 1 ? items[0] : null;
  const flat =
    only && isValidElement(only) && only.type === Fragment
      ? Children.toArray((only.props as { children?: ReactNode }).children)
      : items;
  return flat.reverse();
}

/** apps/web/src/components/ui/dialog.tsx: radius 18, glass, max-w 512, header 24px padding, title 20px. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 512,
  testId,
  showCloseButton = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The top-right X of web's DialogPopup. */
  showCloseButton?: boolean;
  title?: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  testId?: string;
}) {
  const theme = useTheme();
  // dialog.tsx: the viewport pads 16 (`p-4`), so a dialog is at most the window less 32.
  // Below `sm` it sticks to the bottom as a full-width sheet (bottomStickOnMobile:
  // `max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12`, DIALOG_MOBILE_SHEET_CLASS).
  const small = useSmallViewport();
  const viewportWidth = useAtomValue(viewportWidthAtom);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal
        style={
          small
            ? { flexDirection: "column", justifyContent: "flex-end", alignItems: "stretch", paddingTop: 48 }
            : { flexDirection: "column", justifyContent: "center", alignItems: "center", padding: 16 }
        }
      >
        <DialogPrimitive.Backdrop style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.overlay, pointerEvents: "auto" }} />
        <DialogPrimitive.Popup
          testId={testId}
          style={{
            display: "flex",
            flexDirection: "column",
            ...(small
              ? { width: "100%", borderRadius: 0, borderTopWidth: 1 }
              : { width: Math.min(width, Math.max(0, viewportWidth - 32)), borderRadius: RADIUS["2xl"], borderWidth: 1 }),
            borderColor: theme.appearance === "dark" ? alpha("#ffffff", 0.08) : alpha(theme.foreground, 0.1),
            backgroundColor: theme.appearance === "dark" ? "#0f0f0f" : "#ffffff",
            boxShadow: dialogGlassShadow(theme),
            overflow: "hidden",
            position: "relative",
          }}
        >
          {title ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 24, paddingBottom: children || small ? 16 : 24, paddingRight: showCloseButton ? 48 : 24 }}>
              <Text size="xl" weight={600}>
                {title}
              </Text>
              {description ? <Text color={theme.mutedForeground}>{description}</Text> : null}
            </div>
          ) : null}
          {children ? <div style={{ display: "flex", flexDirection: "column", paddingLeft: 24, paddingRight: 24, paddingBottom: 24 }}>{children}</div> : null}
          {footer ? (
            <div
              style={{
                display: "flex",
                // DialogFooter: `flex-col-reverse gap-2 sm:flex-row sm:justify-end`.
                flexDirection: small ? "column" : "row",
                justifyContent: "flex-end",
                alignItems: small ? "stretch" : "center",
                gap: 8,
                paddingTop: 16,
                paddingBottom: 16,
                paddingLeft: 24,
                paddingRight: 24,
                borderTopWidth: 1,
                borderColor: theme.border,
                backgroundColor: alpha(theme.muted, 0.72),
              }}
            >
              {small ? reversedChildren(footer) : footer}
            </div>
          ) : null}
          {showCloseButton ? (
            <div style={{ position: "absolute", top: 12, right: 12, display: "flex" }}>
              <div
                testId={testId ? `${testId}-close` : undefined}
                onClick={() => onOpenChange(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: RADIUS.md,
                  cursor: "pointer",
                  hover: { backgroundColor: theme.accent },
                }}
              >
                <Icon name="x" size={16} color={theme.mutedForeground} />
              </div>
            </div>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ── Tooltip ─────────────────────────────────────────────────────────────

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={500}>{children}</TooltipPrimitive.Provider>;
}

/** apps/web/src/components/ui/tooltip.tsx: radius 8, border, popover bg, 12px text. */
export function Tooltip({
  content,
  description,
  shortcut,
  side = "bottom",
  children,
  rootStyle,
}: {
  content: string;
  /** A second, muted line (RightPanelTabs DeviceTabTooltip: host and version). */
  description?: string;
  shortcut?: string;
  side?: FloatingSide;
  children: ReactElement;
  /** Style of the wrapper the primitive renders around the trigger (e.g. to stretch a row). */
  rootStyle?: Style;
}) {
  const theme = useTheme();
  return (
    <TooltipPrimitive.Root style={rootStyle}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={6}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 8,
          paddingRight: 8,
          maxWidth: 320,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.appearance === "dark" ? "#141414" : "#ffffff",
        }}
      >
        {description ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>{content}</text>
            <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>{description}</text>
          </div>
        ) : (
          <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontFamily: FONTS.sans }}>{content}</text>
        )}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Root>
  );
}
