import { BRAND_MARKS, type BrandMarkName } from "./brandMarks.ts";
import { LUCIDE, type LucideName } from "./lucide.gen.ts";

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
  return (
    <svg
      source={source(name, strokeWidth)}
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
