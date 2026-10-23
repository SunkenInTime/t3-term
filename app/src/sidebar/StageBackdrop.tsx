// apps/web/src/components/SidebarStageBackdrop.tsx + branding.logic.ts: the
// sidebar header artwork that identifies a Dev or Nightly build, and the same
// art filling the send button (StageBackdropButtonArt). The artwork is the web
// SVG with its CSS variables resolved (stageArt.gen.ts), painted as a
// full-colour <img>; gpuix's <svg> is monochrome. The --stage-art-* and
// --stage-night-* variables come from apps/web/src/index.css, per theme and
// appearance, so the art takes the theme's pigments like it does on the web.
import { cssColorToHex, useTheme, type Palette } from "../ui/theme.ts";
import { DEV_BLUEPRINT_SVG, NIGHTLY_SKY_SVG } from "./stageArt.gen.ts";

export type StageBackdropVariant = "nightly" | "dev";

const NIGHTLY_SERVER_VERSION_PATTERN = /^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+$/;

/**
 * Web's APP_STAGE_LABEL is "Dev" for a dev build and "Beta" otherwise; a
 * nightly server overrides it. t3-term run from source counts as a dev build.
 */
const FALLBACK_STAGE_LABEL = /\.(?:tsx?|jsx?)$/.test(Bun.main) ? "Dev" : "Beta";

export function resolveStageLabel(primaryServerVersion: string | null): string {
  return primaryServerVersion && NIGHTLY_SERVER_VERSION_PATTERN.test(primaryServerVersion)
    ? "Nightly"
    : FALLBACK_STAGE_LABEL;
}

export function resolveStageBackdropVariant(
  stageLabel: string,
  enabled: boolean,
): StageBackdropVariant | null {
  if (!enabled) return null;
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "nightly") return "nightly";
  if (normalized === "dev") return "dev";
  return null;
}

// ── Stage palette (index.css) ───────────────────────────────────────────

type StageVar =
  | "art-top"
  | "art-mid"
  | "art-bottom"
  | "art-highlight"
  | "art-secondary"
  | "art-tertiary"
  | "art-line"
  | "art-celeste-highlight"
  | "art-celeste-secondary"
  | "art-violet-highlight"
  | "art-grid-line"
  | "night-base-top"
  | "night-base-mid"
  | "night-base-bottom"
  | "night-top"
  | "night-mid"
  | "night-bottom"
  | "night-highlight"
  | "night-secondary"
  | "night-tertiary"
  | "night-line"
  | "night-glow-highlight"
  | "night-glow-secondary"
  | "night-sparkle";

type StageVars = Partial<Record<StageVar, string>>;

/** :root (the light values) and its @variant dark override. */
const ROOT_VARS: StageVars = {
  "art-top": "oklch(0.782169 0.123386 240.226)",
  "art-mid": "oklch(0.616111 0.195824 259.735)",
  "art-bottom": "oklch(0.441553 0.232394 265.474)",
  "art-highlight": "oklch(0.951597 0.037289 215.482)",
  "art-secondary": "oklch(0.794668 0.12136 235.46)",
  "art-tertiary": "oklch(0.678991 0.170261 275.365)",
  "art-line": "oklch(0.959666 0.029238 218.179)",
  "art-celeste-highlight": "oklch(0.968763 0.045822 196.42)",
  "art-celeste-secondary": "oklch(0.827395 0.126071 211.26)",
  "art-violet-highlight": "oklch(0.895381 0.053248 286.447)",
  "art-grid-line": "oklch(0.966822 0.01757 239.99)",
  "night-base-top": "oklch(0.283792 0.117327 297.201)",
  "night-base-mid": "oklch(0.227147 0.086086 277.99)",
  "night-base-bottom": "oklch(0.200528 0.055699 261.216)",
  "night-highlight": "oklch(0.707246 0.157418 252.091)",
  "night-secondary": "oklch(0.600473 0.182225 277.296)",
  "night-tertiary": "oklch(0.62583 0.210886 305.994)",
  "night-line": "oklch(0.938794 0.029114 273.103)",
  "night-glow-highlight": "oklch(0.553749 0.176543 271.958)",
  "night-glow-secondary": "oklch(0.345571 0.117466 273.568)",
  "night-sparkle": "oklch(0.880867 0.057747 269.011)",
};
const ROOT_DARK_VARS: StageVars = {
  "art-top": "oklch(0.581473 0.149124 256.9)",
  "art-mid": "oklch(0.456509 0.159377 261.945)",
  "art-bottom": "oklch(0.291327 0.136578 267.649)",
};

/** html[data-theme-id="…"] blocks: light values, then @variant dark. */
const THEME_VARS: Readonly<Record<string, { light: StageVars; dark: StageVars }>> = {
  "t3-chat": {
    light: {
      "art-top": "oklch(0.760675 0.141361 348.019)",
      "art-mid": "oklch(0.588093 0.188832 353.138)",
      "art-bottom": "oklch(0.383959 0.135096 348.656)",
      "art-highlight": "oklch(0.949689 0.034241 339.171)",
      "art-secondary": "oklch(0.763402 0.163836 352.525)",
      "art-tertiary": "oklch(0.70819 0.180285 311.949)",
      "art-line": "oklch(0.952158 0.034194 336.179)",
    },
    dark: {
      "art-top": "oklch(0.540689 0.143665 347.587)",
      "art-mid": "oklch(0.396586 0.126592 347.6)",
      "art-bottom": "oklch(0.249959 0.079694 340.523)",
      "art-highlight": "oklch(0.921297 0.051708 343.229)",
      "art-secondary": "oklch(0.667398 0.165674 352.549)",
      "art-tertiary": "oklch(0.609315 0.163722 306.315)",
      "art-line": "oklch(0.945349 0.036045 341.433)",
    },
  },
  grove: {
    light: {
      "art-top": "oklch(0.751465 0.112731 157.313)",
      "art-mid": "oklch(0.567105 0.11099 158.859)",
      "art-bottom": "oklch(0.367918 0.067635 160.558)",
      "art-highlight": "oklch(0.976387 0.034353 161.456)",
      "art-secondary": "oklch(0.80968 0.117071 158.817)",
      "art-tertiary": "oklch(0.784102 0.108047 88.516)",
      "art-line": "oklch(0.981098 0.027812 158.718)",
      "night-top": "oklch(0.45805 0.079616 160.092)",
      "night-mid": "oklch(0.368483 0.065631 162.719)",
      "night-bottom": "oklch(0.264797 0.044397 168.088)",
      "night-highlight": "oklch(0.912563 0.055173 158.974)",
      "night-secondary": "oklch(0.665652 0.109731 156.599)",
      "night-tertiary": "oklch(0.698651 0.103024 89.828)",
      "night-line": "oklch(0.945336 0.041923 157.222)",
    },
    dark: {
      "art-top": "oklch(0.58719 0.09869 157.426)",
      "art-mid": "oklch(0.454979 0.079031 159.756)",
      "art-bottom": "oklch(0.297856 0.050355 161.167)",
      "art-highlight": "oklch(0.952407 0.053872 158.44)",
      "art-secondary": "oklch(0.732591 0.120606 155.853)",
      "art-tertiary": "oklch(0.716282 0.116547 80.563)",
      "art-line": "oklch(0.961577 0.035285 157.03)",
      "night-top": "oklch(0.398632 0.065534 158.601)",
      "night-mid": "oklch(0.290561 0.049694 160.456)",
      "night-bottom": "oklch(0.210147 0.03173 169.818)",
      "night-highlight": "oklch(0.866303 0.057526 156.796)",
      "night-secondary": "oklch(0.586553 0.093722 157.365)",
      "night-tertiary": "oklch(0.6364 0.101769 82.985)",
      "night-line": "oklch(0.913292 0.035718 156.976)",
    },
  },
  ocean: {
    light: {
      "art-top": "oklch(0.792993 0.088072 220.421)",
      "art-mid": "oklch(0.590296 0.116841 243.184)",
      "art-bottom": "oklch(0.409123 0.093718 247.98)",
      "art-highlight": "oklch(0.971217 0.023008 213.615)",
      "art-secondary": "oklch(0.788391 0.090856 215.684)",
      "art-tertiary": "oklch(0.76441 0.099607 187.893)",
      "art-line": "oklch(0.976025 0.019647 212.543)",
    },
    dark: {
      "art-top": "oklch(0.59663 0.089167 233.427)",
      "art-mid": "oklch(0.461094 0.084904 243.478)",
      "art-bottom": "oklch(0.294818 0.05947 250.526)",
      "art-highlight": "oklch(0.952907 0.032224 221.27)",
      "art-secondary": "oklch(0.732079 0.09296 224.414)",
      "art-tertiary": "oklch(0.720885 0.095495 190.903)",
      "art-line": "oklch(0.961039 0.027355 219.756)",
    },
  },
  ember: {
    light: {
      "art-top": "oklch(0.782439 0.118806 52.569)",
      "art-mid": "oklch(0.62863 0.15922 39.401)",
      "art-bottom": "oklch(0.404251 0.117664 30.424)",
      "art-highlight": "oklch(0.962469 0.02774 70.95)",
      "art-secondary": "oklch(0.815735 0.11904 53.659)",
      "art-tertiary": "oklch(0.69361 0.159346 24.787)",
      "art-line": "oklch(0.970313 0.02052 67.583)",
      "night-top": "oklch(0.470236 0.102322 39.355)",
      "night-mid": "oklch(0.345367 0.080697 33.217)",
      "night-bottom": "oklch(0.227386 0.056077 27.437)",
      "night-highlight": "oklch(0.903891 0.059281 56.181)",
      "night-secondary": "oklch(0.641705 0.126508 44.376)",
      "night-tertiary": "oklch(0.538694 0.129931 25.865)",
      "night-line": "oklch(0.926348 0.046029 58.73)",
    },
    dark: {
      "art-top": "oklch(0.597533 0.120694 43.455)",
      "art-mid": "oklch(0.437763 0.101287 34.86)",
      "art-bottom": "oklch(0.264269 0.055858 26.548)",
      "art-highlight": "oklch(0.929214 0.042638 55.801)",
      "art-secondary": "oklch(0.705592 0.137369 43.176)",
      "art-tertiary": "oklch(0.629583 0.158322 24.088)",
      "art-line": "oklch(0.945058 0.033906 58.824)",
      "night-top": "oklch(0.392352 0.081287 36.444)",
      "night-mid": "oklch(0.271305 0.056352 31.135)",
      "night-bottom": "oklch(0.182126 0.028154 27.774)",
      "night-highlight": "oklch(0.851007 0.061294 53.805)",
      "night-secondary": "oklch(0.560789 0.10645 42.953)",
      "night-tertiary": "oklch(0.476228 0.106656 24.165)",
      "night-line": "oklch(0.884931 0.046607 56.556)",
    },
  },
  iris: {
    light: {
      "art-top": "oklch(0.738305 0.113454 298.926)",
      "art-mid": "oklch(0.551826 0.159189 294.531)",
      "art-bottom": "oklch(0.37147 0.133317 289.999)",
      "art-highlight": "oklch(0.949472 0.029204 303.081)",
      "art-secondary": "oklch(0.745085 0.125892 298.647)",
      "art-tertiary": "oklch(0.73066 0.167815 340.964)",
      "art-line": "oklch(0.960278 0.024064 306.969)",
    },
    dark: {
      "art-top": "oklch(0.57297 0.145973 295.185)",
      "art-mid": "oklch(0.419499 0.13752 292.131)",
      "art-bottom": "oklch(0.274235 0.095798 286.608)",
      "art-highlight": "oklch(0.916698 0.047206 300.224)",
      "art-secondary": "oklch(0.670994 0.13095 296.689)",
      "art-tertiary": "oklch(0.679357 0.165376 340.439)",
      "art-line": "oklch(0.940582 0.032921 299.076)",
    },
  },
};

/** The :is(t3-chat, ocean, iris) block: night colors derived from the art pigments. */
const NIGHT_FROM_ART_THEMES = new Set(["t3-chat", "ocean", "iris"]);

type Oklch = readonly [number, number, number];

function parseOklch(value: string): Oklch {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value.trim());
  if (!match) throw new Error(`stage palette: not an oklch() color: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** color-mix(in oklch, a weight, b): shorter-hue interpolation. */
function mixOklch(a: string, b: string, weight: number): string {
  const [l1, c1, h1] = parseOklch(a);
  const [l2, c2, h2] = parseOklch(b);
  let delta = h2 - h1;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const hue = (((h1 + delta * (1 - weight)) % 360) + 360) % 360;
  return `oklch(${l1 * weight + l2 * (1 - weight)} ${c1 * weight + c2 * (1 - weight)} ${hue})`;
}

/** The index.css cascade for one theme and appearance, as oklch() strings. */
function resolveStageVars(themeId: string | null, appearance: Palette["appearance"]): Record<StageVar, string> {
  const vars: StageVars = { ...ROOT_VARS, ...(appearance === "dark" ? ROOT_DARK_VARS : {}) };
  const theme = themeId === null ? undefined : THEME_VARS[themeId];
  if (theme) Object.assign(vars, theme.light, appearance === "dark" ? theme.dark : {});
  const get = (name: StageVar) => vars[name] as string;
  if (theme && NIGHT_FROM_ART_THEMES.has(themeId as string)) {
    vars["night-top"] = mixOklch(get("art-top"), get("night-base-top"), 0.38);
    vars["night-mid"] = mixOklch(get("art-mid"), get("night-base-mid"), 0.38);
    vars["night-bottom"] = mixOklch(get("art-bottom"), get("night-base-bottom"), 0.38);
    vars["night-highlight"] = get("art-highlight");
    vars["night-secondary"] = mixOklch(get("art-secondary"), get("night-mid"), 0.55);
    vars["night-tertiary"] = mixOklch(get("art-tertiary"), get("night-top"), 0.6);
    vars["night-line"] = mixOklch(get("art-line"), "oklch(1 0 0)", 0.82);
  } else {
    vars["night-top"] ??= get("night-base-top");
    vars["night-mid"] ??= get("night-base-mid");
    vars["night-bottom"] ??= get("night-base-bottom");
  }
  if (theme) {
    vars["art-celeste-highlight"] = get("art-highlight");
    vars["art-celeste-secondary"] = get("art-secondary");
    vars["art-violet-highlight"] = get("art-highlight");
    vars["art-grid-line"] = get("art-line");
    vars["night-glow-highlight"] = get("night-highlight");
    vars["night-glow-secondary"] = get("night-secondary");
    vars["night-sparkle"] = get("night-line");
  }
  return vars as Record<StageVar, string>;
}

// stageArt.gen.ts was generated with the standard dark palette; each hex in it
// stands for one variable, so recoloring swaps those hexes.
const DEV_SLOTS: ReadonlyArray<readonly [string, StageVar]> = [
  ["#101f6e", "art-bottom"],
  ["#2050ae", "art-mid"],
  ["#3a7ad1", "art-top"],
  ["#d4f6ff", "art-highlight"],
  ["#65c8ff", "art-secondary"],
  ["#7c8bff", "art-tertiary"],
  ["#ddf7ff", "art-line"],
  ["#d2ffff", "art-celeste-highlight"],
  ["#48dcf5", "art-celeste-secondary"],
  ["#d9d8ff", "art-violet-highlight"],
  ["#eaf6ff", "art-grid-line"],
];
const NIGHTLY_SLOTS: ReadonlyArray<readonly [string, StageVar]> = [
  ["#07152f", "night-bottom"],
  ["#151443", "night-mid"],
  ["#32155b", "night-top"],
  ["#5165d8", "night-glow-highlight"],
  ["#283075", "night-glow-secondary"],
  ["#4ea4ff", "night-highlight"],
  ["#696fea", "night-secondary"],
  ["#a85bea", "night-tertiary"],
  ["#e4eaff", "night-line"],
  ["#c8d7ff", "night-sparkle"],
];

function recolor(svg: string, slots: ReadonlyArray<readonly [string, StageVar]>, vars: Record<StageVar, string>) {
  // Placeholders first, so a new color equal to a later slot's hex isn't swapped twice.
  let out = svg;
  slots.forEach(([hex], index) => {
    out = out.replaceAll(hex, `@@stage${index}@@`);
  });
  slots.forEach(([, name], index) => {
    out = out.replaceAll(`@@stage${index}@@`, cssColorToHex(vars[name]).slice(0, 7));
  });
  return out;
}

/**
 * StageBackdropButtonArt: the art under `preserveAspectRatio="xMinYMin slice"`
 * with viewBox "64 0 8192 96" (nightly "96 0 …") in a square button shows a
 * 96×96 window starting at x 64 (96). No header fade.
 */
function toButtonArt(svg: string, variant: StageBackdropVariant): string {
  const left = variant === "nightly" ? 96 : 64;
  return svg
    .replace(/viewBox="[^"]*" width="[^"]*" height="[^"]*"/, `viewBox="${left} 0 96 96" width="32" height="32"`)
    .replaceAll('width="100%"', 'width="8192"')
    .replace(' mask="url(#t3term-mask)"', "");
}

const dataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const artCache = new Map<string, string>();

/** The stage art as a data URL for the palette's theme and appearance. */
export function stageArtSource(variant: StageBackdropVariant, theme: Palette, kind: "backdrop" | "button"): string {
  const key = `${variant}:${theme.themeId ?? ""}:${theme.appearance}:${kind}`;
  let src = artCache.get(key);
  if (!src) {
    const vars = resolveStageVars(theme.themeId, theme.appearance);
    const svg =
      variant === "nightly" ? recolor(NIGHTLY_SKY_SVG, NIGHTLY_SLOTS, vars) : recolor(DEV_BLUEPRINT_SVG, DEV_SLOTS, vars);
    src = dataUrl(kind === "button" ? toButtonArt(svg, variant) : svg);
    artCache.set(key, src);
  }
  return src;
}

/** 256×80 from the sidebar's top-left; it runs under the header and the search row. */
export function StageBackdrop({ variant, width }: { variant: StageBackdropVariant; width: number }) {
  const theme = useTheme();
  return (
    <img
      src={stageArtSource(variant, theme, "backdrop")}
      objectFit="fill"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height: 80,
        pointerEvents: "none",
      }}
    />
  );
}
