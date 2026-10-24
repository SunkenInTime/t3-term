// Colors for the code surfaces (Diff and Files): pierre-dark / pierre-light as
// the web client paints them through @pierre/diffs, sampled from its DiffPanel.
import type { Palette } from "../../ui/theme.ts";

export function mix(base: string, over: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const [r1, g1, b1] = parse(base);
  const [r2, g2, b2] = parse(over);
  const channel = (from: number, to: number) =>
    Math.round(from + (to - from) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r1!, r2!)}${channel(g1!, g2!)}${channel(b1!, b2!)}`;
}

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

const D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585] as const;
const LAB_E = 216 / 24389;
const LAB_K = 24389 / 27;

function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((index) => srgbToLinear(Number.parseInt(hex.slice(index, index + 2), 16))) as [number, number, number];
  const x65 = 0.4123908 * r + 0.3575843 * g + 0.1804808 * b;
  const y65 = 0.212639 * r + 0.7151687 * g + 0.0721923 * b;
  const z65 = 0.0193308 * r + 0.1191948 * g + 0.9505322 * b;
  // Bradford D65 -> D50, the white point CSS Lab uses.
  const x = 1.0479298 * x65 + 0.0229469 * y65 - 0.0501923 * z65;
  const y = 0.0296278 * x65 + 0.9904344 * y65 - 0.0170738 * z65;
  const z = -0.009243 * x65 + 0.0150552 * y65 + 0.7521316 * z65;
  const f = (t: number) => (t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116);
  const fx = f(x / D50[0]);
  const fy = f(y / D50[1]);
  const fz = f(z / D50[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToHex([lightness, a, b]: readonly [number, number, number]): string {
  const fy = (lightness + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const xr = fx ** 3 > LAB_E ? fx ** 3 : (116 * fx - 16) / LAB_K;
  const yr = lightness > LAB_K * LAB_E ? fy ** 3 : lightness / LAB_K;
  const zr = fz ** 3 > LAB_E ? fz ** 3 : (116 * fz - 16) / LAB_K;
  const x = xr * D50[0];
  const y = yr * D50[1];
  const z = zr * D50[2];
  const x65 = 0.9554734 * x - 0.0230985 * y + 0.0632593 * z;
  const y65 = -0.0283697 * x + 1.0099955 * y + 0.0210414 * z;
  const z65 = 0.012314 * x - 0.0205077 * y + 1.3303659 * z;
  const red = 3.2409699 * x65 - 1.5373832 * y65 - 0.4986108 * z65;
  const green = -0.9692436 * x65 + 1.8759675 * y65 + 0.0415551 * z65;
  const blue = 0.0556301 * x65 - 0.203977 * y65 + 1.0569715 * z65;
  return `#${[red, green, blue].map((channel) => linearToSrgb(channel).toString(16).padStart(2, "0")).join("")}`;
}

/** CSS `color-mix(in lab, base, over amount)`. */
export function mixLab(base: string, over: string, amount: number): string {
  const from = hexToLab(base);
  const to = hexToLab(over);
  return labToHex([0, 1, 2].map((index) => from[index]! + (to[index]! - from[index]!) * amount) as [number, number, number]);
}

/** pierre-dark / pierre-light diff colors as the web client paints them (sampled from its DiffPanel). */
export function diffPalette(theme: Palette) {
  const dark = theme.appearance === "dark";
  const bg = theme.background.slice(0, 7);
  const addition = dark ? "#07c480" : "#18a46c";
  const deletion = dark ? "#ff2e3f" : "#d52c36";
  const modified = "#009fff";
  return {
    bg,
    fg: dark ? "#fafafa" : "#0a0a0a",
    number: dark ? "#a3a3a3" : "#737373",
    addition,
    deletion,
    modified,
    additionLine: dark ? "#0c1713" : mix(bg, addition, 0.1),
    additionGutter: dark ? "#0e1713" : mix(bg, addition, 0.14),
    additionEmphasis: dark ? "#0a3929" : mix(bg, addition, 0.26),
    deletionLine: dark ? "#1c100f" : mix(bg, deletion, 0.08),
    deletionGutter: dark ? "#1c110f" : mix(bg, deletion, 0.12),
    deletionEmphasis: dark ? "#491519" : mix(bg, deletion, 0.22),
    deletionStripeBase: dark ? "#381916" : mix(bg, deletion, 0.25),
    separator: dark ? "#111111" : mix(bg, "#0a0a0a", 0.04),
    separatorText: dark ? "#808080" : "#737373",
    hatch: dark ? "#ffffff12" : "#0000000f",
    // StyledDiffCodeView's [data-selected-line] overrides: the code background with a lab
    // mix of the modified blue (dark 20% of a 30% blend, light 12% of a 50% blend).
    selectedLine: dark ? mixLab(bg, mix(bg, modified, 0.3), 0.2) : mixLab(bg, mix(bg, modified, 0.5), 0.12),
    selectedGutter: dark ? mixLab(bg, mix(bg, modified, 0.4), 0.15) : mixLab(bg, mix(bg, modified, 0.65), 0.09),
    /** --diffs-selection-number-fg: the modified blue mixed toward white (dark) or black (light). */
    selectedNumber: dark ? mixLab(modified, "#ffffff", 0.25) : mixLab(modified, "#000000", 0.35),
  };
}
export type DiffPalette = ReturnType<typeof diffPalette>;
