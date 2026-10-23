// apps/web/src/components/SidebarStageBackdrop.tsx + branding.logic.ts: the
// sidebar header artwork that identifies a Dev or Nightly build. The artwork
// is the web SVG with its CSS variables resolved (stageArt.gen.ts), painted as
// a full-colour <img>; gpuix's <svg> is monochrome.
import { useTheme } from "../ui/theme.ts";
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

const DEV_SRC = `data:image/svg+xml;base64,${Buffer.from(DEV_BLUEPRINT_SVG).toString("base64")}`;
// index.css: --stage-art-top/mid/bottom are lighter outside dark mode. The
// generated art carries the dark values, so the light artwork swaps them back.
const DEV_LIGHT_STOPS: ReadonlyArray<readonly [string, string]> = [
  ["#3a7ad1", "#67c2ff"],
  ["#2050ae", "#347ff8"],
  ["#101f6e", "#1538d0"],
];
const DEV_LIGHT_SVG = DEV_LIGHT_STOPS.reduce(
  (svg, [dark, light]) => svg.replaceAll(dark, light).replaceAll(dark.toUpperCase(), light),
  DEV_BLUEPRINT_SVG,
);
const DEV_LIGHT_SRC = `data:image/svg+xml;base64,${Buffer.from(DEV_LIGHT_SVG).toString("base64")}`;
const NIGHTLY_SRC = `data:image/svg+xml;base64,${Buffer.from(NIGHTLY_SKY_SVG).toString("base64")}`;

/** 256×80 from the sidebar's top-left; it runs under the header and the search row. */
export function StageBackdrop({ variant, width }: { variant: StageBackdropVariant; width: number }) {
  const light = useTheme().appearance === "light";
  return (
    <img
      src={variant === "nightly" ? NIGHTLY_SRC : light ? DEV_LIGHT_SRC : DEV_SRC}
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
