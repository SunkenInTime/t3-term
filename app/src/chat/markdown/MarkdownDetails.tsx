// apps/web/src/components/chat/MarkdownDetails.tsx: a raw-HTML <details> as a
// collapsible: my-2 between border-y rules, a medium 14px summary row behind a
// chevron, content indented 1.5rem at the message colour.
import type { Element, ElementContent } from "hast";
import { memo, useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { alpha } from "../../ui/theme.ts";
import { withAlpha } from "./colors.ts";
import { MARGIN_AWARE, renderFlow, renderParagraph, stack, type RenderEnv } from "./MarkdownView.tsx";
import { deriveRun } from "./styles.ts";

export const MarkdownDetails = memo(function MarkdownDetails({ node, width, env, marginTop }: { node: Element; width: number; env: RenderEnv; marginTop?: number }) {
  const [open, setOpen] = useState(Boolean(node.properties.open));
  const palette = env.styles.palette;
  const summary = node.children.find((child): child is Element => child.type === "element" && child.tagName === "summary");
  const content = node.children.filter((child) => child !== summary) as ElementContent[];
  const summaryStyle = deriveRun(env.styles.body, { face: { family: "sans", weight: 500 }, color: palette.foreground, size: 14, lineHeight: 20 });
  const summaryNode = summary
    ? renderParagraph(summary.children as ElementContent[], width - 24, env, summaryStyle, "s")
    : renderParagraph([{ type: "text", value: "Details" }], width - 24, env, summaryStyle, "s");
  const body = open ? stack(renderFlow(content, width - 24, env, { body: deriveRun(env.styles.body, { color: alpha(palette.foreground, 0.8) }), ulDepth: 0, olDepth: 0 }, "d")) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", marginTop, borderTopWidth: 1, borderBottomWidth: 1, borderColor: withAlpha(env.styles.border, 0.6) }}>
      <div
        onClick={() => setOpen((value) => !value)}
        style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 8, paddingTop: 8, paddingBottom: 8, cursor: "pointer", width: "100%" }}
      >
        <div style={{ display: "flex", alignItems: "center", height: 20, flexShrink: 0, userSelect: "none" }}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={16} color={palette.mutedForeground} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>{summaryNode}</div>
      </div>
      {body ? (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", paddingBottom: 12, paddingLeft: 24 }}>
          {body.nodes}
        </div>
      ) : null}
    </div>
  );
});
MARGIN_AWARE.add(MarkdownDetails);
