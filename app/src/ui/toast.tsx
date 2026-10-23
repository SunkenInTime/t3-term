// apps/web/src/components/ui/toast.tsx: top-right stack, max-w 360, radius 10,
// 14px body, a 16px icon tinted by type ahead of the title, the description
// under both, a 24px dismiss orb on the top-right corner, and optional actions.
//
// Not ported: base-ui's collapsed stack (toasts behind the front one scaled
// and peeking) and swipe-to-dismiss; toasts list at full height instead.
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useState, type ReactNode } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { surfaceStyle } from "./overlay.tsx";
import { Button, Text, type ButtonVariant } from "./primitives.tsx";
import { alpha, useTheme } from "./theme.ts";

export type ToastType = "info" | "success" | "warning" | "error" | "loading";

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastInput {
  readonly type?: ToastType;
  /** web renders no icon for a toast added without a type; t3-term callers default to info, so opt out here. */
  readonly hideIcon?: boolean;
  readonly title: string;
  /** A string, or a node for richer content (web KeybindingsConfigWarning). */
  readonly description?: ReactNode;
  readonly action?: ToastAction;
  /** web ThreadToastData.secondaryActionProps: rendered before the action. */
  readonly secondaryAction?: ToastAction;
  /** web ThreadToastData.actionVariant; defaults to default (filled), outline when actionLayout is unset. */
  readonly actionVariant?: ButtonVariant;
  /** web ThreadToastData.secondaryActionVariant; defaults to outline. */
  readonly secondaryActionVariant?: ButtonVariant;
  /**
   * web ThreadToastData.actionLayout. "stacked-end" (web stackedThreadToast)
   * puts the actions on their own right-aligned row under the text; "inline"
   * trails them after the text. Unset keeps t3-term's original layout: an
   * outline action under the description, left-aligned.
   */
  readonly actionLayout?: "inline" | "stacked-end";
  /** Runs when the user dismisses the toast (web ThreadToastData.onClose), not on dismissToast(). */
  readonly onClose?: () => void;
  /** web ThreadToastData.expandableContent / expandableLabels / expandableDescriptionTrigger. */
  readonly expandable?: {
    readonly content: ReactNode;
    readonly labels?: { readonly expand?: string; readonly collapse?: string };
    /** The description itself toggles the panel, with a chevron after it. */
    readonly descriptionTrigger?: boolean;
  };
  /** ms; 0 keeps it until dismissed. Defaults to 5000 (errors 8000, loading 0). */
  readonly duration?: number;
}

interface ToastEntry extends ToastInput {
  readonly id: number;
}

const toastsAtom = Atom.make<ReadonlyArray<ToastEntry>>([]).pipe(Atom.keepAlive);
let nextId = 1;
// One timer per toast, so an update replaces the old countdown instead of racing it.
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function schedule(id: number, input: ToastInput): void {
  const previous = timers.get(id);
  if (previous !== undefined) clearTimeout(previous);
  timers.delete(id);
  const duration = input.duration ?? (input.type === "error" ? 8000 : input.type === "loading" ? 0 : 5000);
  if (duration > 0) timers.set(id, setTimeout(() => dismissToast(id), duration));
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  appAtomRegistry.set(
    toastsAtom,
    appAtomRegistry.get(toastsAtom).filter((toast) => toast.id !== id),
  );
}

export function toast(input: ToastInput): number {
  const id = nextId++;
  appAtomRegistry.set(toastsAtom, [...appAtomRegistry.get(toastsAtom), { ...input, id }].slice(-5));
  schedule(id, input);
  return id;
}

/** Replaces a live toast's content in place (web toastManager.update). No-op once it is gone. */
export function updateToast(id: number, input: ToastInput): void {
  const toasts = appAtomRegistry.get(toastsAtom);
  if (!toasts.some((toast) => toast.id === id)) return;
  appAtomRegistry.set(
    toastsAtom,
    toasts.map((toast) => (toast.id === id ? { ...input, id } : toast)),
  );
  schedule(id, input);
}

/** True while the toast is on screen; coordinators use it to re-add one the user closed. */
export function isToastOpen(id: number): boolean {
  return appAtomRegistry.get(toastsAtom).some((toast) => toast.id === id);
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
  if (toasts.length === 0) return null;
  return (
    <anchored fill="window" deferred priority={5} occlude={false} style={{ backgroundColor: "transparent", pointerEvents: "none" }}>
      {/* web: --toast-inset (32) below --workspace-topbar-height (52), so toasts clear the header. */}
      <div style={{ position: "absolute", top: 84, right: 32, display: "flex", flexDirection: "column", gap: 12, width: 360 }}>
        {toasts.map((entry) => (
          <ToastCard key={entry.id} entry={entry} />
        ))}
      </div>
    </anchored>
  );
}

function ToastCard({ entry }: { entry: ToastEntry }) {
  const theme = useTheme();
  const type = entry.type ?? "info";
  const tint: Record<ToastType, string> = {
    info: theme.infoForeground,
    success: theme.successForeground,
    warning: theme.warningForeground,
    error: theme.errorForeground,
    loading: alpha(theme.foreground, 0.8),
  };
  const hasActions = entry.action !== undefined || entry.secondaryAction !== undefined;
  // web's two layouts, plus t3-term's original one for callers that name none:
  // the actions on a row of their own under the text, left-aligned.
  const layout = !hasActions ? "inline" : (entry.actionLayout ?? "below");
  const stacked = layout === "stacked-end" && entry.action !== undefined;
  const inlineActions = layout === "inline" && hasActions;
  const actions = hasActions ? (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        ...(stacked ? { justifyContent: "flex-end", width: "100%" } : layout === "below" ? { marginTop: 4 } : { flexShrink: 0 }),
      }}
    >
      {entry.secondaryAction ? (
        <Button size="xs" variant={entry.secondaryActionVariant ?? "outline"} onClick={entry.secondaryAction.onClick}>
          {entry.secondaryAction.label}
        </Button>
      ) : null}
      {entry.action ? (
        <Button
          size="xs"
          testId={`toast-${entry.id}-action`}
          variant={entry.actionVariant ?? (layout === "below" ? "outline" : "default")}
          onClick={entry.action.onClick}
        >
          {entry.action.label}
        </Button>
      ) : null}
    </div>
  ) : null;
  return (
    // The orb is the card's sibling, not its child: GPUI strokes a border over
    // the element's children, so the card's edge would cut through the orb.
    <div testId={`toast-${entry.id}`} style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", pointerEvents: "auto" }}>
      <div
        style={{
          ...surfaceStyle(theme),
          display: "flex",
          // web: stacked-end is a column with the actions last; inline keeps them trailing.
          flexDirection: stacked ? "column" : "row",
          alignItems: stacked ? "stretch" : "center",
          gap: stacked ? 8 : 6,
          paddingTop: stacked ? 10 : 12,
          paddingBottom: stacked ? 10 : 12,
          paddingLeft: 14,
          paddingRight: inlineActions ? 24 : 14,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 0,
            ...(stacked ? { paddingRight: 20 } : { flexGrow: 1, flexShrink: 1, flexBasis: 0 }),
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", gap: 8, minWidth: 0, ...(stacked || inlineActions ? {} : { paddingRight: 24 }) }}>
            {entry.hideIcon ? null : (
              <div style={{ display: "flex", alignItems: "center", height: 20, flexShrink: 0 }}>
                <Icon name={ICONS[type]} size={16} color={tint[type]} />
              </div>
            )}
            <Text weight={500} style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
              {entry.title}
            </Text>
          </div>
          <ToastDescription entry={entry} />
          {layout === "below" ? actions : null}
        </div>
        {layout === "below" ? null : actions}
      </div>
      {/* web toastCornerDismissClass: a 24px orb half over the top-right corner. */}
      <div
        testId={`toast-${entry.id}-dismiss`}
        onClick={() => {
          entry.onClose?.();
          dismissToast(entry.id);
        }}
        style={{
          position: "absolute",
          top: -6,
          right: -6,
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.6),
          backgroundColor: alpha(theme.popover, 0.92),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 1, spreadRadius: 0, color: "#0000000d" },
          hover: { backgroundColor: theme.popover },
        }}
      >
        <Icon name="x" size={12} color={theme.mutedForeground} />
      </div>
    </div>
  );
}

const EXPANDABLE_PANEL_MAX_HEIGHT = 160;

function ToastDescription({ entry }: { entry: ToastEntry }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const description =
    entry.description === undefined || entry.description === null || entry.description === "" ? null : typeof entry.description === "string" ? (
      <Text
        color={theme.mutedForeground}
        // web clamps long error descriptions to four lines.
        {...(entry.type === "error" && entry.description.length >= 180 ? { lineClamp: 4 } : {})}
        style={hovered && entry.expandable?.descriptionTrigger ? { textDecoration: "underline" } : undefined}
      >
        {entry.description}
      </Text>
    ) : (
      entry.description
    );
  const expandable = entry.expandable;
  if (!expandable) return description;
  const expandLabel = expandable.labels?.expand ?? "Show details";
  const collapseLabel = expandable.labels?.collapse ?? "Hide details";
  const panel = open ? (
    <div
      style={{
        marginTop: 8,
        maxHeight: EXPANDABLE_PANEL_MAX_HEIGHT,
        overflowY: "scroll",
        paddingRight: 2,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {expandable.content}
    </div>
  ) : null;
  if (expandable.descriptionTrigger) {
    return (
      <>
        <div
          testId={`toast-${entry.id}-expand`}
          onClick={() => setOpen((value) => !value)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 6,
            width: "100%",
            minWidth: 0,
            borderRadius: 4,
            cursor: "pointer",
            backgroundColor: hovered ? alpha(theme.muted, 0.4) : "#00000000",
          }}
        >
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>{description}</div>
          <div style={{ display: "flex", alignItems: "center", height: 20, flexShrink: 0, opacity: 0.8 }}>
            <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
          </div>
        </div>
        {panel}
      </>
    );
  }
  return (
    <>
      {description}
      <div
        testId={`toast-${entry.id}-expand`}
        onClick={() => setOpen((value) => !value)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 2, paddingBottom: 2, cursor: "pointer" }}
      >
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
        <Text size="xs" weight={500} color={theme.mutedForeground}>
          {open ? collapseLabel : expandLabel}
        </Text>
      </div>
      {panel}
    </>
  );
}
