// The landing every prompt-link state renders: NewThreadLinkView.tsx `LinkPage` and the failed
// state in routes/_chat.new.tsx. ui/empty.tsx default size: a centered column with p-12;
// EmptyHeader max-w-md; title semibold text-xl; description text-sm muted, mt-1; buttons mt-5,
// centered, gap-2. Web's browser build shows no header here, only Electron's drag strip.
import type { ReactNode } from "react";
import { useState } from "react";

import { FONTS, TEXT, useTheme } from "../ui/theme.ts";

const MAX_WIDTH = 448;

export function LinkPage({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <div
      testId="prompt-link-page"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flexGrow: 1,
        minHeight: 0,
        minWidth: 0,
        padding: 48,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: MAX_WIDTH }}>
        <BalancedText size="xl" weight={600} color={theme.foreground} testId="prompt-link-title">
          {title}
        </BalancedText>
        {description ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", marginTop: 4 }}>
            <BalancedText size="sm" color={theme.mutedForeground}>
              {description}
            </BalancedText>
          </div>
        ) : null}
        {children ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
              marginTop: 20,
              width: "100%",
            }}
          >
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Web's `text-balance`: wrapped lines of even length rather than a full first line and a short
 * last one. gpuix has no balanced wrapping, so a hidden single-line copy measures the text, the
 * visible copy is capped at width / lines, and the cap grows if that width needs another line.
 */
function BalancedText({
  children,
  size,
  weight,
  color,
  testId,
}: {
  readonly children: string;
  readonly size: keyof typeof TEXT;
  readonly weight?: number;
  readonly color: string;
  readonly testId?: string;
}) {
  const [natural, setNatural] = useState<{ readonly text: string; readonly width: number } | null>(null);
  const [slack, setSlack] = useState(0);
  const lineHeight = TEXT[size][1];
  const width = natural?.text === children ? natural.width : null;
  const lines = width === null ? 1 : Math.ceil(width / MAX_WIDTH);
  const cap = lines <= 1 || width === null ? undefined : Math.min(MAX_WIDTH, Math.ceil(width / lines) + slack);
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      <div style={{ position: "absolute", top: 0, left: 0, opacity: 0, pointerEvents: "none" }}>
        <text
          onLayout={(event) => {
            const measured = (event as { width?: number }).width;
            if (typeof measured === "number" && (natural?.text !== children || Math.abs(natural.width - measured) > 0.5)) {
              setNatural({ text: children, width: measured });
              setSlack(0);
            }
          }}
          style={{ color, fontSize: TEXT[size][0], lineHeight, fontFamily: FONTS.sans, whiteSpace: "nowrap", ...(weight ? { fontWeight: weight } : {}) }}
        >
          {children}
        </text>
      </div>
      <text
        testId={testId}
        onLayout={(event) => {
          const height = (event as { height?: number }).height;
          // The cap can split a word the balanced width needs: widen until the line count holds.
          if (cap !== undefined && cap < MAX_WIDTH && typeof height === "number" && height > lines * lineHeight + 1) {
            setSlack((value) => value + 8);
          }
        }}
        style={{
          color,
          fontSize: TEXT[size][0],
          lineHeight,
          fontFamily: FONTS.sans,
          textAlign: "center",
          ...(weight ? { fontWeight: weight } : {}),
          ...(cap === undefined ? {} : { maxWidth: cap }),
        }}
      >
        {children}
      </text>
    </div>
  );
}
