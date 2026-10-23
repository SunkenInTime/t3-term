// A dropdown that renders web's ContextMenuItem trees (the desktop app shows the
// same items as a native context menu): icons, separators, checked items,
// destructive rows and hover-opened submenus.
import type { ContextMenuItem } from "@t3tools/contracts";
import { DismissableLayer } from "@gpuix/react";
import { FloatingLayer, type FloatingAlign, type FloatingSide } from "@gpuix/react/floating";
import { useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { LUCIDE } from "../../ui/lucide.gen.ts";
import { surfaceStyle } from "../../ui/overlay.tsx";
import type { Style } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, useTheme } from "../../ui/theme.ts";

const ICON_ALIASES: Record<string, IconName> = { trash: "trash-2" as IconName };

function menuIcon(name: string | undefined): IconName | null {
  if (!name) return null;
  const alias = ICON_ALIASES[name];
  if (alias && alias in LUCIDE) return alias;
  return name in LUCIDE ? (name as IconName) : null;
}

export function ActionMenu<T extends string>({
  items,
  open,
  onOpenChange,
  onSelect,
  trigger,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  alignOffset = 0,
  minWidth = 160,
  testId,
  rootStyle,
}: {
  items: ReadonlyArray<ContextMenuItem<T>>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: T) => void;
  trigger: ReactNode;
  side?: FloatingSide;
  align?: FloatingAlign;
  sideOffset?: number;
  alignOffset?: number;
  minWidth?: number;
  testId?: string;
  rootStyle?: Style;
}) {
  const theme = useTheme();
  // A click inside an open submenu lands outside the root surface; it must not close the menu
  // before the submenu row's click arrives.
  const pointerInSubmenu = useRef(false);
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
            onMouseDownOutside={() => {
              if (!pointerInSubmenu.current) onOpenChange(false);
            }}
            style={{ ...surfaceStyle(theme), display: "flex", flexDirection: "column", padding: 4, minWidth }}
          >
            <MenuItems
              items={items}
              onSelect={(id) => {
                pointerInSubmenu.current = false;
                onOpenChange(false);
                onSelect(id);
              }}
              onSubmenuPointer={(inside) => {
                pointerInSubmenu.current = inside;
              }}
              testId={testId}
            />
          </FloatingLayer>
        </DismissableLayer>
      ) : null}
    </div>
  );
}

function MenuItems<T extends string>({
  items,
  onSelect,
  onSubmenuPointer,
  testId,
}: {
  items: ReadonlyArray<ContextMenuItem<T>>;
  onSelect: (id: T) => void;
  onSubmenuPointer: (inside: boolean) => void;
  testId?: string | undefined;
}) {
  const theme = useTheme();
  const [openSub, setOpenSub] = useState<string | null>(null);
  return (
    <>
      {items.map((item, index) => (
        <div key={`${item.id}:${index}`} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
          {item.separatorBefore && index > 0 ? (
            <div
              style={{
                height: 1,
                marginTop: 4,
                marginBottom: 4,
                marginLeft: -4,
                marginRight: -4,
                backgroundColor: theme.border,
                flexShrink: 0,
              }}
            />
          ) : null}
          {item.header ? (
            <div style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 4 }}>
              <text style={{ color: theme.mutedForeground, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>
                {item.label}
              </text>
            </div>
          ) : (
            <MenuRow
              item={item}
              submenuOpen={openSub === item.id}
              onHover={() => setOpenSub(item.children?.length ? item.id : null)}
              onSelect={onSelect}
              onSubmenuPointer={onSubmenuPointer}
              testId={testId ? `${testId}-${item.id}` : undefined}
            />
          )}
        </div>
      ))}
    </>
  );
}

function MenuRow<T extends string>({
  item,
  submenuOpen,
  onHover,
  onSelect,
  onSubmenuPointer,
  testId,
}: {
  item: ContextMenuItem<T>;
  submenuOpen: boolean;
  onHover: () => void;
  onSelect: (id: T) => void;
  onSubmenuPointer: (inside: boolean) => void;
  testId?: string | undefined;
}) {
  const theme = useTheme();
  const icon = menuIcon(item.icon);
  const hasChildren = (item.children?.length ?? 0) > 0;
  const color = item.destructive ? theme.errorForeground : theme.foreground;
  const disabled = item.disabled === true;
  return (
    <div style={{ display: "flex", position: "relative", flexDirection: "column" }}>
      <div
        testId={testId}
        onMouseEnter={disabled ? undefined : onHover}
        onClick={disabled ? undefined : hasChildren ? onHover : () => onSelect(item.id)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 28,
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: RADIUS.sm,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "default" : "pointer",
          backgroundColor: submenuOpen ? theme.accent : "#00000000",
          ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
        }}
      >
        {icon ? (
          <Icon name={icon} size={16} color={item.destructive ? theme.errorForeground : theme.mutedForeground} />
        ) : null}
        <text
          style={{
            color,
            fontSize: 14,
            lineHeight: 20,
            fontFamily: FONTS.sans,
            flexGrow: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            overflow: "hidden",
          }}
        >
          {item.label}
        </text>
        {item.checked ? <Icon name="check" size={16} color={theme.foreground} /> : null}
        {hasChildren ? <Icon name="chevron-right" size={16} color={theme.mutedForeground} /> : null}
      </div>
      {hasChildren && submenuOpen ? (
        <FloatingLayer
          side="right"
          align="start"
          sideOffset={8}
          alignOffset={-4}
          onMouseEnter={() => onSubmenuPointer(true)}
          onMouseLeave={() => onSubmenuPointer(false)}
          style={{ ...surfaceStyle(theme), display: "flex", flexDirection: "column", padding: 4, minWidth: 160 }}
        >
          <MenuItems
            items={item.children ?? []}
            onSelect={onSelect}
            onSubmenuPointer={onSubmenuPointer}
            testId={testId}
          />
        </FloatingLayer>
      ) : null}
    </div>
  );
}
