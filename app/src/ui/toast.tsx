// apps/web/src/components/ui/toast.tsx: top-right stack, max-w 360, radius 10,
// 14px body, a 16px icon tinted by type, optional action.
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { surfaceStyle } from "./overlay.tsx";
import { Button, IconButton, Text } from "./primitives.tsx";
import { useTheme } from "./theme.ts";

export type ToastType = "info" | "success" | "warning" | "error" | "loading";

export interface ToastInput {
  readonly type?: ToastType;
  readonly title: string;
  readonly description?: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
  /** ms; 0 keeps it until dismissed. Defaults to 5000 (errors 8000). */
  readonly duration?: number;
}

interface ToastEntry extends ToastInput {
  readonly id: number;
}

const toastsAtom = Atom.make<ReadonlyArray<ToastEntry>>([]).pipe(Atom.keepAlive);
let nextId = 1;

export function dismissToast(id: number): void {
  appAtomRegistry.set(
    toastsAtom,
    appAtomRegistry.get(toastsAtom).filter((toast) => toast.id !== id),
  );
}

export function toast(input: ToastInput): number {
  const id = nextId++;
  appAtomRegistry.set(toastsAtom, [...appAtomRegistry.get(toastsAtom), { ...input, id }].slice(-5));
  const duration = input.duration ?? (input.type === "error" ? 8000 : input.type === "loading" ? 0 : 5000);
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}

export function updateToast(id: number, input: ToastInput): void {
  appAtomRegistry.set(
    toastsAtom,
    appAtomRegistry.get(toastsAtom).map((toast) => (toast.id === id ? { ...input, id } : toast)),
  );
  const duration = input.duration ?? (input.type === "error" ? 8000 : 5000);
  if (duration > 0 && input.type !== "loading") setTimeout(() => dismissToast(id), duration);
}

const ICONS: Record<ToastType, IconName> = {
  info: "info",
  success: "circle-check",
  warning: "triangle-alert",
  error: "circle-alert",
  loading: "loader-circle",
};

export function ToastHost() {
  const toasts = useAtomValue(toastsAtom);
  const theme = useTheme();
  if (toasts.length === 0) return null;
  const tint: Record<ToastType, string> = {
    info: theme.infoForeground,
    success: theme.successForeground,
    warning: theme.warningForeground,
    error: theme.errorForeground,
    loading: theme.mutedForeground,
  };
  return (
    <anchored fill="window" deferred priority={5} occlude={false} style={{ backgroundColor: "transparent", pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: 32, right: 32, display: "flex", flexDirection: "column", gap: 8, width: 360 }}>
        {toasts.map((entry) => (
          <div
            key={entry.id}
            testId={`toast-${entry.id}`}
            style={{
              ...surfaceStyle(theme),
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 10,
              paddingTop: 12,
              paddingBottom: 12,
              paddingLeft: 14,
              paddingRight: 10,
              pointerEvents: "auto",
            }}
          >
            <div style={{ paddingTop: 2 }}>
              <Icon name={ICONS[entry.type ?? "info"]} size={16} color={tint[entry.type ?? "info"]} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0 }}>
              <Text weight={500}>{entry.title}</Text>
              {entry.description ? <Text color={theme.mutedForeground}>{entry.description}</Text> : null}
              {entry.action ? (
                <div style={{ display: "flex", flexDirection: "row", marginTop: 6 }}>
                  <Button size="xs" variant="outline" onClick={entry.action.onClick}>
                    {entry.action.label}
                  </Button>
                </div>
              ) : null}
            </div>
            <IconButton icon="x" size={20} iconSize={12} onClick={() => dismissToast(entry.id)} />
          </div>
        ))}
      </div>
    </anchored>
  );
}
