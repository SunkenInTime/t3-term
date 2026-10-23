// Inline atomic boxes of chat markdown: web's ContextChip family (file, thread,
// skill, citation and context chips), link favicons and task checkboxes.
//
// apps/web/src/components/ContextChip.tsx: inline-flex, h 1.41em, px 0.5em,
// gap 0.33em, rounded 0.5em, 1px border, font-medium at 0.86em, svg 1.17em,
// vertical-align middle. Accent colours per kind; border = accent 34% mixed
// into the border colour, fill = accent at 11%, text = accent 22% into the
// foreground (oklab). Hover: border 48%, fill 17%.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { faviconUrlForOrigin } from "@t3tools/shared/favicon";
import { resolvePathLinkTarget, splitFilePathPosition } from "@t3tools/shared/fileLinks";
import { isAbsolutePath, isNetworkPath, normalizeProjectPathForComparison } from "@t3tools/shared/path";
import { Atom } from "effect/reactivity";
import { memo, useEffect, useState, type ReactNode } from "react";

import { environmentThreadShells, projectEnvironment } from "../../state/environment.ts";
import { FileEntryIcon } from "../../panels/files/FileEntryIcon.tsx";
import { BRAND_MARKS } from "../../ui/brandMarks.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Tooltip } from "../../ui/overlay.tsx";
import { FONTS, cssColorToHex, type Palette } from "../../ui/theme.ts";
import { useEnvironmentQuery } from "../../web/state/query.ts";
import { mixOklab, withAlpha } from "./colors.ts";
import type { BoxAtom, RunStyle } from "./inline.ts";
import type { FileChipTarget } from "./links.ts";
import { textWidth } from "./measure.ts";
import { baselineOffset } from "./styles.ts";
import { middleAlignedTop, normalizeModifiers, useLinkHover, type LinkEntry, type RenderEnv } from "./MarkdownView.tsx";

export type ChipKind = "mention" | "thread" | "skill" | "citation" | "file" | "image" | "terminal" | "neutral";

const CHIP_ACCENTS: Record<Exclude<ChipKind, "neutral">, string> = {
  mention: "oklch(0.62 0.11 215)",
  thread: "oklch(0.62 0.12 190)",
  skill: "oklch(0.62 0.16 322)",
  citation: "oklch(0.62 0.16 259)",
  file: "oklch(0.62 0.136 237)",
  image: "oklch(0.62 0.16 16)",
  terminal: "oklch(0.62 0.134 163)",
};

export interface ChipColors {
  readonly border: string;
  readonly borderHover: string;
  readonly background: string;
  readonly backgroundHover: string;
  readonly foreground: string;
}

const chipColorCache = new WeakMap<Palette, Map<ChipKind, ChipColors>>();

export function chipColors(palette: Palette, kind: ChipKind): ChipColors {
  let byKind = chipColorCache.get(palette);
  if (!byKind) {
    byKind = new Map();
    chipColorCache.set(palette, byKind);
  }
  const cached = byKind.get(kind);
  if (cached) return cached;
  let colors: ChipColors;
  if (kind === "neutral") {
    colors = {
      border: withAlpha(palette.border, 0.7),
      borderHover: withAlpha(palette.border, 0.7),
      background: withAlpha(palette.accent, 0.4),
      backgroundHover: withAlpha(palette.accent, 0.4),
      foreground: palette.foreground,
    };
  } else {
    const accent = cssColorToHex(CHIP_ACCENTS[kind]);
    colors = {
      border: mixOklab(accent, palette.border, 0.34),
      borderHover: mixOklab(accent, palette.border, 0.48),
      background: withAlpha(accent, 0.11),
      backgroundHover: withAlpha(accent, 0.17),
      foreground: mixOklab(accent, palette.foreground, 0.22),
    };
  }
  byKind.set(kind, colors);
  return colors;
}

/** Chip geometry for a paragraph font size (everything is in em of the chip's 0.86em font). */
export function chipMetrics(parentSize: number) {
  const size = parentSize * 0.86;
  return {
    fontSize: size,
    height: size * 1.41,
    padX: size * 0.5,
    gap: size * 0.33,
    radius: size * 0.5,
    icon: size * 1.17,
  };
}

export interface ChipPayload {
  readonly type: "chip";
  readonly kind: ChipKind;
  readonly label: string;
  readonly icon: ChipIcon;
  readonly tooltip?: string | undefined;
  readonly dashed?: boolean | undefined;
  readonly onActivate?: ((modifiers: ReturnType<typeof normalizeModifiers>) => void) | undefined;
  readonly onContextMenu?: ((position: { x: number; y: number }) => void) | undefined;
  readonly fileMetadata?: { readonly environmentId: EnvironmentId | null; readonly path: string; readonly cwd: string | undefined } | undefined;
  readonly threadRef?: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } | undefined;
}

export type ChipIcon =
  | { readonly kind: "lucide"; readonly name: IconName }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "svg"; readonly source: string };

/** Builds a chip box atom, measuring its label so the line breaker knows its width. */
export function chipAtom(id: string, payload: ChipPayload, base: RunStyle, maxWidth: number, link?: number): BoxAtom {
  const metrics = chipMetrics(base.size);
  const labelWidth = textWidth({ family: "sans", weight: 500 }, metrics.fontSize, payload.label);
  const natural = 2 + 2 * metrics.padX + metrics.icon + metrics.gap + labelWidth;
  const width = Math.min(natural, Math.max(40, maxWidth));
  return { kind: "box", id, width, height: metrics.height, link, payload: { ...payload, base, width } };
}

function useFileKind(target: ChipPayload["fileMetadata"]): { kind: "file" | "directory"; mimeType?: string } {
  const hostPath = target ? splitFilePathPosition(target.path).path : "";
  const resolved = target
    ? normalizeProjectPathForComparison(
        hostPath.startsWith("~/") || !target.cwd ? hostPath : resolvePathLinkTarget(hostPath, target.cwd),
      )
    : "";
  const absolute = isAbsolutePath(resolved) || resolved.startsWith("~/");
  // web useFileMetadata: servers stat what they are asked about, and a network
  // path leaks NTLM credentials, so only absolute local paths are asked about.
  const query = useEnvironmentQuery(
    target?.environmentId && absolute && !isNetworkPath(resolved) && resolved.length <= 512
      ? projectEnvironment.fileMetadata({ environmentId: target.environmentId, input: { path: resolved } })
      : null,
  );
  const data = query.data as { kind?: string; mimeType?: string } | null;
  return { kind: data?.kind === "directory" ? "directory" : "file", ...(data?.mimeType ? { mimeType: data.mimeType } : {}) };
}

const NO_THREAD_SHELL = null;

function useThreadTitle(ref: ChipPayload["threadRef"], fallback: string): string {
  const shell = useAtomValue(
    ref ? environmentThreadShells.threadShellAtom(scopeThreadRef(ref.environmentId, ref.threadId)) : NO_THREAD_ATOM,
  ) as { title?: string } | null;
  return shell?.title?.trim() || fallback;
}

const NO_THREAD_ATOM = Atom.make(NO_THREAD_SHELL);

export const ChipBox = memo(function ChipBox({ atom, env }: { atom: BoxAtom; env: RenderEnv }) {
  const payload = atom.payload as ChipPayload & { base: RunStyle; width: number };
  const palette = env.styles.palette;
  const colors = chipColors(palette, payload.kind);
  const metrics = chipMetrics(payload.base.size);
  const [hovered, setHovered] = useState(false);
  const [linkHovered, hoverProps] = useLinkHover(env, atom.link);
  const fileKind = useFileKind(payload.fileMetadata);
  const label = useThreadTitle(payload.threadRef, payload.label);
  const interactive = Boolean(payload.onActivate);
  const active = interactive && (hovered || linkHovered);
  const top = middleAlignedTop(payload.base, metrics.height);
  let icon: ReactNode;
  if (payload.icon.kind === "file") {
    icon =
      fileKind.kind === "directory" ? (
        <Icon name="folder" size={metrics.icon} color={palette.mutedForeground} />
      ) : (
        <FileEntryIcon pathValue={payload.icon.path} kind="file" size={metrics.icon} {...(fileKind.mimeType ? { mimeType: fileKind.mimeType } : {})} />
      );
  } else if (payload.icon.kind === "svg") {
    icon = <svg source={payload.icon.source} style={{ width: metrics.icon, height: metrics.icon, flexShrink: 0, color: colors.foreground }} />;
  } else {
    icon = <Icon name={payload.icon.name} size={metrics.icon} color={colors.foreground} />;
  }
  const chip = (
    <div
      onMouseEnter={() => {
        setHovered(true);
        hoverProps.onMouseEnter?.();
      }}
      onMouseLeave={() => {
        setHovered(false);
        hoverProps.onMouseLeave?.();
      }}
      onClick={payload.onActivate ? (event) => payload.onActivate?.(normalizeModifiers(event.modifiers)) : undefined}
      onAuxClick={
        payload.onContextMenu
          ? (event) => {
              if (event.isRightClick) payload.onContextMenu?.({ x: event.x ?? 0, y: event.y ?? 0 });
            }
          : undefined
      }
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: metrics.gap,
        width: payload.width,
        height: metrics.height,
        flexShrink: 0,
        marginTop: top,
        paddingLeft: metrics.padX,
        paddingRight: metrics.padX,
        borderRadius: metrics.radius,
        borderWidth: 1,
        borderColor: active ? colors.borderHover : colors.border,
        ...(payload.dashed ? { borderStyle: "dashed" as const } : {}),
        backgroundColor: active ? colors.backgroundHover : colors.background,
        cursor: interactive ? "pointer" : "default",
        overflow: "hidden",
      }}
    >
      {icon}
      <text
        style={{
          fontFamily: FONTS.sans,
          fontSize: metrics.fontSize,
          fontWeight: 500,
          lineHeight: metrics.fontSize * 1.25,
          color: colors.foreground,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
          flexShrink: 1,
          minWidth: 0,
        }}
      >
        {label}
      </text>
    </div>
  );
  return payload.tooltip ? (
    <Tooltip content={payload.tooltip} side="top">
      {chip}
    </Tooltip>
  ) : (
    chip
  );
});

// ── Favicons (MarkdownExternalLink.tsx) ─────────────────────────────────

export interface FaviconPayload {
  readonly type: "favicon";
  readonly host: string;
  readonly base: RunStyle;
}

const FAVICON_SIZE = 14;
// host -> data URL, or null once the favicon failed (web falls back to a globe on error).
const faviconCache = new Map<string, Promise<string | null>>();
const faviconResults = new Map<string, string | null>();

function loadFavicon(host: string, url: string): Promise<string | null> {
  let pending = faviconCache.get(host);
  if (!pending) {
    pending = fetch(url, { signal: AbortSignal.timeout(8000) })
      .then(async (response) => {
        const type = response.headers.get("content-type") ?? "";
        if (!response.ok || !/^image\//.test(type)) return null;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0 || bytes.length > 256 * 1024) return null;
        return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
      })
      .catch(() => null)
      .then((result) => {
        faviconResults.set(host, result);
        return result;
      });
    faviconCache.set(host, pending);
  }
  return pending;
}

function useFavicon(host: string, url: string | null): string | null | undefined {
  const [value, setValue] = useState<string | null | undefined>(() => (url ? faviconResults.get(host) : null));
  useEffect(() => {
    if (!url || faviconResults.has(host)) return;
    let live = true;
    void loadFavicon(host, url).then((result) => {
      if (live) setValue(result);
    });
    return () => {
      live = false;
    };
  }, [host, url]);
  return url ? (faviconResults.get(host) ?? value) : null;
}

function isGitHubHost(host: string): boolean {
  const hostname = host.toLowerCase();
  return hostname === "github.com" || hostname.endsWith(".github.com");
}

export function faviconAtom(id: string, host: string, base: RunStyle, link: number): BoxAtom {
  // ms-[0.25em] me-[0.2em], size 14px
  return {
    kind: "box",
    id,
    width: FAVICON_SIZE,
    height: FAVICON_SIZE,
    marginLeft: base.size * 0.25,
    marginRight: base.size * 0.2,
    link,
    payload: { type: "favicon", host, base } satisfies FaviconPayload,
  };
}

export const FaviconBox = memo(function FaviconBox({ atom, env }: { atom: BoxAtom; env: RenderEnv }) {
  const payload = atom.payload as FaviconPayload;
  const [, hoverProps] = useLinkHover(env, atom.link);
  const entry = atom.link !== undefined ? env.links[atom.link] : undefined;
  // vertical-align: -0.125em puts the 14px box's bottom 0.125em under the baseline.
  const baseline = baselineOffset(payload.base.face.family, payload.base.size, payload.base.lineHeight);
  const top = baseline + payload.base.size * 0.125 - FAVICON_SIZE;
  const color = env.styles.linkColor;
  const github = isGitHubHost(payload.host);
  const url = github ? null : faviconUrlForOrigin(`https://${payload.host}`);
  const favicon = useFavicon(payload.host, url);
  return (
    <div
      {...hoverProps}
      onClick={entry ? (event) => env.actions.activateLink(entry, normalizeModifiers(event.modifiers)) : undefined}
      style={{
        display: "flex",
        width: FAVICON_SIZE,
        height: FAVICON_SIZE,
        flexShrink: 0,
        marginTop: top,
        marginLeft: atom.marginLeft ?? 0,
        marginRight: atom.marginRight ?? 0,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {github ? (
        <svg source={BRAND_MARKS["brand-github" as keyof typeof BRAND_MARKS] ?? ""} style={{ width: FAVICON_SIZE, height: FAVICON_SIZE, color }} />
      ) : favicon ? (
        <img src={favicon} objectFit="contain" style={{ width: FAVICON_SIZE, height: FAVICON_SIZE, borderRadius: 2 }} />
      ) : (
        // Loading or failed: web shows the globe once the favicon errors.
        <Icon name="globe" size={FAVICON_SIZE} color={color} />
      )}
    </div>
  );
});

// ── Task checkbox ───────────────────────────────────────────────────────

export interface CheckboxPayload {
  readonly type: "checkbox";
  readonly checked: boolean;
  readonly base: RunStyle;
}

export function checkboxAtom(id: string, checked: boolean, base: RunStyle, listIndent: number): BoxAtom {
  // input: margin-inline -1.25rem 0.35em, vertical-align middle; Chrome's box is 13px.
  return {
    kind: "box",
    id,
    width: 13,
    height: 13,
    marginLeft: -listIndent,
    marginRight: base.size * 0.35,
    payload: { type: "checkbox", checked, base } satisfies CheckboxPayload,
  };
}

export function CheckboxBox({ atom, env }: { atom: BoxAtom; env: RenderEnv }) {
  const payload = atom.payload as CheckboxPayload;
  const palette = env.styles.palette;
  const top = middleAlignedTop(payload.base, 13) - payload.base.size * 0.075;
  // A disabled, read-only checkbox: Chrome greys both states.
  const fill = palette.appearance === "dark" ? "#6b6b6b" : "#a3a3a3";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 13,
        height: 13,
        flexShrink: 0,
        marginTop: top,
        marginLeft: atom.marginLeft ?? 0,
        marginRight: atom.marginRight ?? 0,
        borderRadius: 2,
        borderWidth: payload.checked ? 0 : 1,
        borderColor: fill,
        backgroundColor: payload.checked ? fill : "#00000000",
        userSelect: "none",
      }}
    >
      {payload.checked ? <Icon name="check" size={11} strokeWidth={3} color={palette.background} /> : null}
    </div>
  );
}

export type { FileChipTarget, LinkEntry };
