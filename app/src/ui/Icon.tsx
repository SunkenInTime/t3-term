import { BRAND_MARKS, type BrandMarkName } from "./brandMarks.ts";
import { LUCIDE, type LucideName } from "./lucide.gen.ts";
import { useTheme } from "./theme.ts";

/** A lucide icon, or a filled brand mark (`brand-*`) that ignores strokeWidth. */
export type IconName = LucideName | BrandMarkName;

const cache = new Map<string, string>();

function source(name: IconName, strokeWidth: number): string {
  const key = `${name}:${strokeWidth}`;
  let svg = cache.get(key);
  if (svg === undefined) {
    if (name in BRAND_MARKS) return BRAND_MARKS[name as BrandMarkName];
    svg = LUCIDE[name as LucideName];
    if (strokeWidth !== 2) svg = svg.replace('stroke-width="2"', `stroke-width="${strokeWidth}"`);
    cache.set(key, svg);
  }
  return svg;
}

export function Icon({
  name,
  size = 16,
  color,
  strokeWidth = 2,
  opacity,
}: {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
  opacity?: number;
}) {
  // Light strokes on a dark surface come out of GPUI's rasterizer about a
  // third of a pixel heavier than Chrome draws them (a 16px search icon: ~35%
  // more ink, edge pixels at full colour where Chrome tops out near 85%).
  // Thinning the stroke by a constant ~0.3px brings the ink back to web's.
  // Measured in dark mode only; light mode keeps web's stroke until it is.
  const dark = useTheme().appearance === "dark";
  const width = dark ? Math.round(strokeWidth * (1 - 3.6 / Math.max(size, 8)) * 100) / 100 : strokeWidth;
  return (
    <svg
      source={source(name, width)}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        color,
        pointerEvents: "none",
        ...(opacity === undefined ? {} : { opacity }),
      }}
    />
  );
}
