// Port of apps/web/src/components/chat/ComposerBanner.tsx: the surfaces that dock
// above the composer (approval, question, plan, queue, notices).
//
// Web draws the surface on a ::before layer with a backdrop blur and masks it where
// the composer overlaps. GPUI has neither, so the surface is the composer's own
// near-opaque card color, and the composer (painted later) covers the 17px overlap.
import { createContext, useContext, useEffect, type ReactNode } from "react";

import { Icon as LucideIcon, type IconName } from "../../ui/Icon.tsx";
import type { Style } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, TEXT, alpha, useTheme, type Palette } from "../../ui/theme.ts";

export type ComposerBannerVariant = "default" | "error" | "info" | "success" | "warning";
export type ComposerBannerDensity = "default" | "comfortable" | "spacious";
export type ComposerBannerPlacement = "attached" | "floating";

/** --chat-composer-drawer-inset: banners are the composer width minus 22px each side. */
export const COMPOSER_DRAWER_INSET = 22;
/** --chat-composer-attachment-overlap: 1rem + 1px tucked under the next surface. */
export const COMPOSER_ATTACHMENT_OVERLAP = 17;
/** --composer-banner-icon-column at sm: (24px). */
export const BANNER_ICON_COLUMN = 24;

const PADDING_BLOCK: Record<ComposerBannerDensity, number> = { default: 4, comfortable: 5, spacious: 12 };

function surfaceColors(theme: Palette, variant: ComposerBannerVariant) {
  const neutralOutline =
    theme.themeId !== null
      ? theme.composer.outline
      : theme.appearance === "dark"
        ? alpha("#ffffff", 0.05)
        : alpha(theme.foreground, 0.08);
  switch (variant) {
    case "error":
      return { outline: alpha(theme.error, 0.32), tint: alpha(theme.error, 0.08) };
    case "warning":
      return { outline: alpha(theme.warning, 0.28), tint: alpha(theme.warning, 0.08) };
    default:
      return { outline: neutralOutline, tint: null };
  }
}

/** Banner surface: outline, glass fill, variant tint and the seam shadow above the composer. */
export function BannerRoot({
  children,
  variant = "default",
  density = "default",
  placement = "attached",
  joinedAbove = false,
  testId,
  style,
}: {
  children?: ReactNode;
  variant?: ComposerBannerVariant;
  density?: ComposerBannerDensity;
  placement?: ComposerBannerPlacement;
  /** Another attached surface sits directly above: continue it with a square, borderless top. */
  joinedAbove?: boolean;
  testId?: string;
  style?: Style;
}) {
  const theme = useTheme();
  const colors = surfaceColors(theme, variant);
  const attached = placement === "attached";
  const radius = attached && joinedAbove ? 0 : RADIUS["2xl"];
  const padBlock = PADDING_BLOCK[density];
  const padInline = density === "spacious" ? 12 : 4;
  return (
    <div
      testId={testId}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        borderWidth: 1,
        ...(attached && joinedAbove ? { borderTopWidth: 0 } : {}),
        borderColor: colors.outline,
        borderTopLeftRadius: radius,
        borderTopRightRadius: radius,
        borderBottomLeftRadius: attached ? 0 : radius,
        borderBottomRightRadius: attached ? 0 : radius,
        // Opaque: web blurs the glass behind banners; GPUI can't, and timeline text would show through.
        backgroundColor:
          theme.themeId !== null ? theme.composer.surface : theme.appearance === "dark" ? "#101010" : theme.card,
        boxShadow:
          theme.appearance === "dark"
            ? { offsetX: 0, offsetY: 14, blurRadius: 32, spreadRadius: -18, color: "#000000bf" }
            : { offsetX: 0, offsetY: 12, blurRadius: 28, spreadRadius: -18, color: "#00000066" },
        pointerEvents: "auto",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          paddingLeft: padInline,
          paddingRight: padInline,
          paddingTop: padBlock,
          paddingBottom: padBlock + (attached ? COMPOSER_ATTACHMENT_OVERLAP : 0),
          borderTopLeftRadius: Math.max(radius - 1, 0),
          borderTopRightRadius: Math.max(radius - 1, 0),
          borderBottomLeftRadius: attached ? 0 : radius - 1,
          borderBottomRightRadius: attached ? 0 : radius - 1,
          backgroundColor: colors.tint ?? "#00000000",
        }}
      >
        {children}
      </div>
      {attached && theme.appearance === "dark" ? (
        // bg-composer-seam-above: an 18% shade fading up 10px from where the composer starts.
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: COMPOSER_ATTACHMENT_OVERLAP,
            height: 10,
            pointerEvents: "none",
            background: {
              type: "linear-gradient",
              angle: 0,
              stops: [
                { color: "#0000002e", position: 0 },
                { color: "#00000000", position: 1 },
              ],
            },
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * ComposerBanner.Attachment, inside the dock: full dock width, tucked 17px under
 * whatever follows (the next attachment or the composer surface).
 */
export function BannerAttachment({ children, testId }: { children?: ReactNode; testId?: string }) {
  return (
    <div
      testId={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        marginBottom: -COMPOSER_ATTACHMENT_OVERLAP,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Attached surfaces chain: each one continues the surface above it. Surfaces passed in
 * from outside (the queued-runs control) register here so the dock knows they rendered.
 */
export const BannerChainContext = createContext<{ readonly registerAttachment: () => () => void }>({
  registerAttachment: () => () => {},
});

/** Marks an externally rendered attachment as present while `present` is true. */
export function useRegisterBannerAttachment(present: boolean): void {
  const { registerAttachment } = useContext(BannerChainContext);
  useEffect(() => (present ? registerAttachment() : undefined), [present, registerAttachment]);
}

/** ComposerBanner.Row: [icon column][content][actions]. */
export function BannerRow({
  children,
  layout = "inline",
  onClick,
  testId,
  style,
}: {
  children?: ReactNode;
  layout?: "inline" | "approval";
  onClick?: () => void;
  testId?: string;
  style?: Style;
}) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: layout === "approval" ? "flex-start" : "center",
        columnGap: layout === "approval" ? 8 : 4,
        minHeight: BANNER_ICON_COLUMN,
        width: "100%",
        minWidth: 0,
        borderRadius: RADIUS.sm,
        ...(onClick ? { cursor: "pointer" } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** ComposerBanner.Icon: the 24px leading column, 12px muted icon (16px warning in approvals). */
export function BannerIcon({
  name,
  approval,
  color,
  children,
  style,
}: {
  name?: IconName;
  approval?: boolean;
  color?: string;
  children?: ReactNode;
  style?: Style;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: BANNER_ICON_COLUMN,
        minHeight: approval ? undefined : BANNER_ICON_COLUMN,
        flexShrink: 0,
        ...(approval ? { paddingTop: 2 } : {}),
        ...style,
      }}
    >
      {name ? (
        <LucideIcon
          name={name}
          size={approval ? 16 : 12}
          color={color ?? (approval ? theme.warning : theme.mutedForeground)}
        />
      ) : null}
      {children}
    </div>
  );
}

/** ComposerBanner.Content */
export function BannerContent({ children, style }: { children?: ReactNode; style?: Style }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** ComposerBanner.Actions */
export function BannerActions({ children, approval }: { children?: ReactNode; approval?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: approval ? 6 : 4,
        flexShrink: 0,
        ...(approval ? { alignSelf: "center" } : {}),
      }}
    >
      {children}
    </div>
  );
}

/** Banner text: 12/16 by default, like the banner root's text-xs/4. */
export function BannerText({
  children,
  color,
  size = "xs",
  weight,
  truncate,
  mono,
  grow,
  testId,
  style,
}: {
  children: ReactNode;
  color?: string;
  size?: keyof typeof TEXT;
  weight?: number;
  truncate?: boolean;
  mono?: boolean;
  grow?: boolean;
  testId?: string;
  style?: Style;
}) {
  const theme = useTheme();
  const [fontSize, lineHeight] = TEXT[size];
  return (
    <text
      testId={testId}
      style={{
        color: color ?? theme.foreground,
        fontSize,
        lineHeight,
        fontFamily: mono ? FONTS.mono : FONTS.sans,
        ...(weight === undefined ? {} : { fontWeight: weight }),
        ...(truncate
          ? { whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }
          : { flexShrink: 0 }),
        ...(grow ? { flexGrow: 1, flexShrink: 1, flexBasis: 0 } : {}),
        ...style,
      }}
    >
      {children}
    </text>
  );
}

/** ComposerBanner.Count */
export function BannerCount({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", justifyContent: "center", minWidth: BANNER_ICON_COLUMN, flexShrink: 0 }}>
      <BannerText weight={500} color={theme.mutedForeground}>
        {children}
      </BannerText>
    </div>
  );
}

/** ComposerBanner.ToggleIcon: decorative icon-xs ghost chevron (the row is the button). */
export function BannerToggleIcon({ expanded }: { expanded: boolean }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        flexShrink: 0,
        pointerEvents: "none",
      }}
    >
      <LucideIcon name={expanded ? "chevron-down" : "chevron-up"} size={14} color={theme.mutedForeground} />
    </div>
  );
}

/** Small square ghost button used in banners (dismiss, edit, grip): icon-xs, 14px icon. */
export function BannerIconButton({
  icon,
  onClick,
  disabled,
  muted = true,
  testId,
  style,
}: {
  icon: IconName;
  onClick?: () => void;
  disabled?: boolean;
  muted?: boolean;
  testId?: string;
  style?: Style;
}) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      // GPUI does not bubble clicks, so this never also toggles a clickable banner row.
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: RADIUS.md,
        flexShrink: 0,
        opacity: disabled ? 0.64 : 1,
        cursor: disabled ? "default" : "pointer",
        ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
        ...style,
      }}
    >
      <LucideIcon name={icon} size={14} color={muted ? theme.mutedForeground : theme.foreground} />
    </div>
  );
}
