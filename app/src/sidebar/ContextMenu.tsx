// A right-click menu at a window position, for the ContextMenuItem trees web
// hands to `localApi.contextMenu.show` (threadActionMenu.logic.ts). Submenus open
// on hover to the right. A transparent full-window layer under the menu closes
// it on any outside press, like a native context menu.
import { DismissableLayer } from "@gpuix/react";
import { FloatingLayer } from "@gpuix/react/floating";
import type { ContextMenuItem } from "@t3tools/contracts";
import { useState } from "react";

import { Icon, type IconName } from "../ui/Icon.tsx";
import { LUCIDE } from "../ui/lucide.gen.ts";
import { surfaceStyle } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { RADIUS, useTheme } from "../ui/theme.ts";

function iconFor(name: string | undefined): IconName | null {
  if (!name) return null;
  const mapped = name === "trash" ? "trash-2" : name;
  return Object.prototype.hasOwnProperty.call(LUCIDE, mapped) ? (mapped as IconName) : null;
}

function MenuRow<T extends string>({
  item,
  submenuOpen,
  onHover,
  onSelect,
  onClose,
}: {
  item: ContextMenuItem<T>;
  submenuOpen: boolean;
  onHover: () => void;
  onSelect: (id: T) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const icon = iconFor(item.icon);
  const hasChildren = (item.children?.length ?? 0) > 0;
  const color = item.destructive ? theme.errorForeground : theme.foreground;
  const highlighted = !item.disabled && (hovered || submenuOpen);
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div
        testId={`context-menu-item-${item.id}`}
        onMouseEnter={() => {
          setHovered(true);
          onHover();
        }}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {
          if (item.disabled || hasChildren) return;
          onSelect(item.id);
          onClose();
        }}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 28,
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: RADIUS.sm,
          opacity: item.disabled ? 0.5 : 1,
          cursor: item.disabled ? "default" : "pointer",
          backgroundColor: highlighted ? theme.accent : "#00000000",
        }}
      >
        {icon ? (
          <Icon name={icon} size={16} color={item.destructive ? theme.errorForeground : theme.mutedForeground} />
        ) : null}
        <Text color={color} style={{ flexGrow: 1, whiteSpace: "nowrap" }}>
          {item.label}
        </Text>
        {item.checked ? <Icon name="check" size={16} color={theme.foreground} /> : null}
        {hasChildren ? <Icon name="chevron-right" size={16} color={theme.mutedForeground} /> : null}
      </div>
      {hasChildren && submenuOpen && !item.disabled ? (
        <FloatingLayer
          side="right"
          align="start"
          sideOffset={4}
          alignOffset={-4}
          style={{ ...surfaceStyle(theme), display: "flex", flexDirection: "column", padding: 4, minWidth: 160 }}
        >
          <MenuItems items={item.children!} onSelect={onSelect} onClose={onClose} />
        </FloatingLayer>
      ) : null}
    </div>
  );
}

function MenuItems<T extends string>({
  items,
  onSelect,
  onClose,
}: {
  items: ReadonlyArray<ContextMenuItem<T>>;
  onSelect: (id: T) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  return (
    <>
      {items.map((item, index) => (
        <div key={item.id} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
          {item.separatorBefore && index > 0 ? (
            <div style={{ height: 1, marginTop: 4, marginBottom: 4, marginLeft: 8, marginRight: 8, backgroundColor: theme.border }} />
          ) : null}
          <MenuRow
            item={item}
            submenuOpen={openSubmenu === item.id}
            onHover={() => setOpenSubmenu(item.children && item.children.length > 0 ? item.id : null)}
            onSelect={onSelect}
            onClose={onClose}
          />
        </div>
      ))}
    </>
  );
}

export function ContextMenu<T extends string>({
  items,
  x,
  y,
  onSelect,
  onClose,
  testId,
}: {
  items: ReadonlyArray<ContextMenuItem<T>>;
  x: number;
  y: number;
  onSelect: (id: T) => void;
  onClose: () => void;
  testId?: string;
}) {
  const theme = useTheme();
  return (
    <DismissableLayer onEscapeKeyDown={onClose}>
      <anchored fill="window" deferred priority={1} style={{ backgroundColor: "transparent" }}>
        <div
          onMouseDown={onClose}
          onAuxClick={onClose}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "auto" }}
        />
      </anchored>
      <anchored
        position={{ x, y }}
        anchor="topLeft"
        fit="snap"
        snapMargin={8}
        deferred
        priority={2}
        style={{ backgroundColor: "transparent", borderRadius: RADIUS.lg }}
      >
        <div
          testId={testId}
          style={{ ...surfaceStyle(theme), display: "flex", flexDirection: "column", padding: 4, minWidth: 160 }}
        >
          <MenuItems items={items} onSelect={onSelect} onClose={onClose} />
        </div>
      </anchored>
    </DismissableLayer>
  );
}
