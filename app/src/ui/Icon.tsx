import { LUCIDE, type LucideName } from "./lucide.gen.ts";

export type IconName = LucideName;

const cache = new Map<string, string>();

function source(name: IconName, strokeWidth: number): string {
  const key = `${name}:${strokeWidth}`;
  let svg = cache.get(key);
  if (svg === undefined) {
    svg = LUCIDE[name];
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
