// Port of apps/web/src/components/settings/EnvironmentRoutesList.tsx: the saved routes
// to one environment, preferred first. Web reorders them with dnd-kit; here the grip
// captures the pointer (gpuix: onMouseDown + onMouseMove) and the rows rearrange live
// while it moves, the way dnd-kit's vertical sorting strategy shifts them. Up/Down on a
// focused grip moves a route one place, like dnd-kit's keyboard sensor.
import { useAtomValue } from "@effect/atom-react";
import {
  type ConnectionRoute,
  connectionRouteAddress,
  connectionRouteId,
  connectionRouteLabel,
  connectionRoutes,
  isLearned,
} from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";
import { useRef, useState } from "react";

import { requestConfirmDialog } from "../../dialogs/confirmDialog.ts";
import { environmentCatalog, environmentSession } from "../../state/environment.ts";
import { useAtomCommand, type EnvironmentPresentation } from "../../state/settings.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { Button, IconButton, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";

function arrayMove<T>(items: ReadonlyArray<T>, from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

interface Drag {
  readonly id: string;
  readonly from: number;
  readonly startY: number;
  readonly dy: number;
}

export function EnvironmentRoutesList({ environment, onAddRoute }: { readonly environment: EnvironmentPresentation; readonly onAddRoute: () => void }) {
  const theme = useTheme();
  const saved = connectionRoutes(environment.entry);
  const savedIds = saved.map((route) => connectionRouteId(route.target));
  const [pending, setPending] = useState<ReadonlyArray<string> | null>(null);
  const order: Array<string> =
    pending !== null && pending.length === savedIds.length && pending.some((id, index) => id !== savedIds[index]) ? [...pending] : savedIds;
  const byId = new Map(saved.map((route) => [connectionRouteId(route.target), route]));

  const prepared = useAtomValue(environmentSession.preparedConnectionValueAtom(environment.environmentId));
  const activeRouteId = Option.isSome(prepared) && environment.connection.phase === "connected" ? connectionRouteId(prepared.value.target) : null;
  const reorder = useAtomCommand(environmentCatalog.reorderRoutes, { label: "Reorder routes" });
  const removeRoute = useAtomCommand(environmentCatalog.removeRoute, { label: "Remove route" });

  const [drag, setDrag] = useState<Drag | null>(null);
  const rowPitch = useRef(40);
  const overIndex = drag === null ? null : Math.max(0, Math.min(order.length - 1, drag.from + Math.round(drag.dy / rowPitch.current)));
  const shown = drag === null || overIndex === null ? order : arrayMove(order, drag.from, overIndex);
  const routes = shown.flatMap((id) => byId.get(id) ?? []);

  const commitOrder = (next: Array<string>) => {
    if (next.every((id, index) => id === order[index])) return;
    setPending(next);
    void reorder({ environmentId: environment.environmentId, routeIds: next }).then((result) => {
      if (result._tag === "Failure") setPending(null);
    });
  };

  const confirmRemove = async (route: ConnectionRoute) => {
    const address = connectionRouteAddress(route);
    const confirmed = await requestConfirmDialog(`Remove ${connectionRouteLabel(route)} route?${address === null ? "" : `\n${address}`}`, {
      variant: "destructive",
    });
    if (confirmed !== true) return;
    await removeRoute({ environmentId: environment.environmentId, routeId: connectionRouteId(route.target) });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 8, paddingTop: 8, paddingBottom: 8, borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) }}>
      {routes.map((route, index) => {
        const id = connectionRouteId(route.target);
        const dragged = drag?.id === id;
        return (
          <RouteRow
            key={id}
            route={route}
            inUse={id === activeRouteId}
            removable={routes.length > 1 && !isLearned(route)}
            dragged={dragged}
            // The dragged row follows the pointer; the rest have already moved to their new slots.
            offset={dragged && drag && overIndex !== null ? drag.dy - (overIndex - drag.from) * rowPitch.current : 0}
            onMeasure={index === 0 ? (height) => (rowPitch.current = height) : undefined}
            onGripDown={(y) => setDrag({ id, from: order.indexOf(id), startY: y, dy: 0 })}
            onGripMove={(y) => {
              if (drag?.id !== id) return;
              setDrag({ ...drag, dy: y - drag.startY });
            }}
            onGripUp={() => {
              if (drag?.id !== id || overIndex === null) return setDrag(null);
              const next = arrayMove(order, drag.from, overIndex);
              setDrag(null);
              commitOrder(next);
            }}
            onGripKey={(direction) => {
              const from = order.indexOf(id);
              const to = from + direction;
              if (to < 0 || to >= order.length) return;
              commitOrder(arrayMove(order, from, to));
            }}
            onRemove={() => void confirmRemove(route)}
          />
        );
      })}
      <div style={{ display: "flex", flexDirection: "row", marginLeft: -6, paddingTop: 4 }}>
        <Button size="xs" variant="ghost-muted" icon="plus" onClick={onAddRoute} testId={`environment-add-route-${environment.environmentId}`}>
          Add route
        </Button>
      </div>
    </div>
  );
}

function RouteRow({
  route,
  inUse,
  removable,
  dragged,
  offset,
  onMeasure,
  onGripDown,
  onGripMove,
  onGripUp,
  onGripKey,
  onRemove,
}: {
  readonly route: ConnectionRoute;
  readonly inUse: boolean;
  readonly removable: boolean;
  readonly dragged: boolean;
  readonly offset: number;
  readonly onMeasure: ((height: number) => void) | undefined;
  readonly onGripDown: (y: number) => void;
  readonly onGripMove: (y: number) => void;
  readonly onGripUp: () => void;
  readonly onGripKey: (direction: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const theme = useTheme();
  const label = connectionRouteLabel(route);
  const address = connectionRouteAddress(route);
  const id = connectionRouteId(route.target);
  return (
    <div
      onLayout={onMeasure ? (event) => onMeasure(event.height ?? 40) : undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingTop: 8,
        paddingBottom: 8,
        userSelect: "none",
        ...(dragged
          ? {
              position: "relative",
              top: offset,
              borderRadius: RADIUS.md,
              backgroundColor: theme.background,
              boxShadow: { offsetX: 0, offsetY: 4, blurRadius: 3, spreadRadius: -1, color: "#0000001a" },
            }
          : {}),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text size="xs" weight={500}>
            {label}
          </Text>
          {inUse ? (
            <div style={{ display: "flex", paddingLeft: 4, paddingRight: 4, borderRadius: RADIUS.sm, backgroundColor: alpha(theme.success, 0.12) }}>
              <Text size="2xs" color={theme.successForeground}>
                In use
              </Text>
            </div>
          ) : null}
        </div>
        {address !== null ? (
          <Text size="2xs" color={theme.mutedForeground} truncate>
            {`${address}${isLearned(route) ? " · found automatically" : ""}`}
          </Text>
        ) : null}
      </div>
      <div
          testId={`route-grip-${id}`}
          tabIndex={0}
          onMouseDown={(event) => onGripDown(event.y ?? 0)}
          onMouseMove={(event) => {
            if (event.y !== undefined) onGripMove(event.y);
          }}
          onMouseUp={onGripUp}
          onKeyDown={(event) => {
            if (event.key === "up" || event.key === "down") {
              event.preventDefault();
              onGripKey(event.key === "up" ? -1 : 1);
            }
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            flexShrink: 0,
            borderRadius: 4,
            cursor: "grab",
            active: { cursor: "grabbing" },
          }}
        >
          <Icon name="grip-vertical" size={14} color={alpha(theme.mutedForeground, 0.7)} />
        </div>
      {removable ? (
        <Tooltip content="Remove route" side="top">
          <IconButton icon="x" size={24} iconSize={12} onClick={onRemove} testId={`route-remove-${id}`} />
        </Tooltip>
      ) : null}
    </div>
  );
}
