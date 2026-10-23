// CSS color math the markdown chips need: `color-mix(in oklab, a p%, b)` with
// premultiplied alpha (CSS Color 5), and `color/NN` alpha scaling, on
// #rrggbb[aa] colors. Chip colors in web's ContextChip are all written this way.
import { cssColorToHex } from "../../ui/theme.ts";

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseHex(hex: string): Rgba {
  const value = cssColorToHex(hex);
  const channel = (index: number) => Number.parseInt(value.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return { r: channel(0), g: channel(1), b: channel(2), a: value.length === 9 ? channel(3) : 1 };
}

function toHex({ r, g, b, a }: Rgba): string {
  const byte = (value: number) =>
    Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 0.999 ? byte(a) : ""}`;
}

const toLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const toSrgb = (value: number) => (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);

function toOklab({ r, g, b }: Rgba): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: [number, number, number], alpha: number): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
}

/** color-mix(in oklab, a weight, b): premultiplied, so a translucent side pulls less. */
export function mixOklab(a: string, b: string, weight: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const alpha = ca.a * weight + cb.a * (1 - weight);
  if (alpha <= 0) return "#00000000";
  const la = toOklab(ca);
  const lb = toOklab(cb);
  const mixed = [0, 1, 2].map((index) => (la[index]! * ca.a * weight + lb[index]! * cb.a * (1 - weight)) / alpha) as [
    number,
    number,
    number,
  ];
  return toHex(fromOklab(mixed, alpha));
}

/** `color/NN`: scales the alpha of any CSS color. */
export function withAlpha(color: string, amount: number): string {
  const parsed = parseHex(color);
  return toHex({ ...parsed, a: parsed.a * amount });
}

/** Flattens a translucent color over an opaque one, for surfaces gpuix can only paint flat. */
export function over(top: string, bottom: string): string {
  const t = parseHex(top);
  const b = parseHex(bottom);
  return toHex({
    r: t.r * t.a + b.r * (1 - t.a),
    g: t.g * t.a + b.g * (1 - t.a),
    b: t.b * t.a + b.b * (1 - t.a),
    a: 1,
  });
}
