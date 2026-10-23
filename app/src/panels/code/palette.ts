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
  };
}
export type DiffPalette = ReturnType<typeof diffPalette>;
