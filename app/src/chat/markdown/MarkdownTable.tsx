// apps/web/src/components/chat/MarkdownTable.tsx with the `.chat-markdown
// table` rules (index.css 2120-2185): 12px text, row separators only, header
// row semibold and unwrapped, cells padded 0.45rem 0.75rem. Expanded (the
// wordWrap default) wraps cells and fits the lane once it is at least 36rem
// wide; collapsed keeps every cell on one line, truncated at 24rem. Wider
// tables scroll sideways. Column widths follow the browser's auto table
// layout: max-content when it fits, otherwise min-content plus a share of the
// rest in proportion to each column's slack.
import type { Element, ElementContent } from "hast";
import { memo, useState, type ReactNode } from "react";

import { getClientSettings } from "../../state/clientSettings.ts";
import { Menu, MenuItem } from "../../ui/overlay.tsx";
import { useTheme } from "../../ui/theme.ts";
import { hastPlainTextDeep } from "../../web/components/chat/markdownHast.logic.ts";
import { withAlpha } from "./colors.ts";
import { CodeBlockIconButton, useCopyFeedback } from "./MarkdownCodeBlock.tsx";
import { textWidth } from "./measure.ts";
import { MARGIN_AWARE, renderParagraph, type RenderEnv } from "./MarkdownView.tsx";
import { deriveRun } from "./styles.ts";
import type { RunStyle } from "./inline.ts";

const CELL_PAD_X = 12;
const CELL_PAD_Y = 7.2;
const HEAD_PAD_Y = 8.8;
const CELL_MAX = 384;
const WIDE_LANE = 576;
const TEXT_SIZE = 12;

interface Cell {
  readonly node: Element;
  readonly header: boolean;
  readonly text: string;
  readonly align: "left" | "center" | "right";
}

function rowsOf(table: Element): Cell[][] {
  const rows: Cell[][] = [];
  const visit = (node: Element) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (child.tagName === "tr") {
        const cells: Cell[] = [];
        for (const cell of child.children) {
          if (cell.type !== "element" || (cell.tagName !== "td" && cell.tagName !== "th")) continue;
          const align = String(cell.properties.align ?? "");
          cells.push({
            node: cell,
            header: cell.tagName === "th",
            text: hastPlainTextDeep(cell).replace(/\s+/g, " ").trim(),
            align: align === "center" || align === "right" ? align : "left",
          });
        }
        if (cells.length > 0) rows.push(cells);
      } else if (child.tagName === "thead" || child.tagName === "tbody" || child.tagName === "tfoot") {
        visit(child);
      }
    }
  };
  visit(table);
  return rows;
}

function tableToMarkdown(rows: Cell[][]): string {
  if (rows.length === 0) return "";
  const columns = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) => `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
  const pad = (row: Cell[]) => Array.from({ length: columns }, (_, index) => row[index]?.text ?? "");
  const [head, ...body] = rows;
  return [line(pad(head!)), line(Array.from({ length: columns }, () => "---")), ...body.map((row) => line(pad(row)))].join("\n");
}

function tableToCsv(rows: Cell[][]): string {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  return rows.map((row) => row.map((entry) => cell(entry.text)).join(",")).join("\n");
}

function longestWord(text: string, style: RunStyle): number {
  let widest = 0;
  for (const word of text.split(/\s+/)) widest = Math.max(widest, textWidth(style.face, style.size, word));
  return widest;
}

export const MarkdownTable = memo(function MarkdownTable({ node, width, env, marginTop }: { node: Element; width: number; env: RenderEnv; marginTop?: number }) {
  const palette = useTheme();
  const [expanded, setExpanded] = useState(() => getClientSettings().wordWrap);
  const [copied, copy] = useCopyFeedback();
  const [menuOpen, setMenuOpen] = useState(false);
  const rows = rowsOf(node);
  const columns = Math.max(0, ...rows.map((row) => row.length));
  const body = deriveRun(env.styles.body, { size: TEXT_SIZE, lineHeight: TEXT_SIZE * 1.625 });
  const head = deriveRun(body, { face: { family: "sans", weight: 600 } });
  const wide = width >= WIDE_LANE;
  // Expanded cells wrap only in a wide lane; narrow lanes keep max-content columns and scroll.
  const wraps = expanded && wide;

  const maxContent: number[] = Array.from({ length: columns }, () => 0);
  const minContent: number[] = Array.from({ length: columns }, () => 0);
  let clipped = false;
  for (const row of rows) {
    row.forEach((cell, index) => {
      const style = cell.header ? head : body;
      const natural = textWidth(style.face, style.size, cell.text) + 2 * CELL_PAD_X + 1;
      if (natural - 2 * CELL_PAD_X > CELL_MAX) clipped = true;
      const capped = expanded || cell.header ? natural : Math.min(natural, CELL_MAX + 2 * CELL_PAD_X);
      maxContent[index] = Math.max(maxContent[index]!, capped);
      // Headers never wrap (thead th: nowrap); body cells can break at words.
      const min = cell.header && !wraps ? natural : longestWord(cell.text, style) + 2 * CELL_PAD_X + 1;
      minContent[index] = Math.max(minContent[index]!, wraps ? min : capped);
    });
  }
  const sumMax = maxContent.reduce((sum, value) => sum + value, 0);
  const sumMin = minContent.reduce((sum, value) => sum + value, 0);
  let widths: number[];
  if (!wraps) {
    // min-width: max-content; width 100% stretches short tables to the lane.
    widths = sumMax < width ? maxContent.map((value) => (value * width) / sumMax) : maxContent;
  } else if (sumMax <= width) {
    widths = maxContent.map((value) => (value * width) / Math.max(1, sumMax));
  } else if (sumMin >= width) {
    widths = minContent;
  } else {
    const share = (width - sumMin) / Math.max(1, sumMax - sumMin);
    widths = minContent.map((value, index) => value + (maxContent[index]! - value) * share);
  }
  const tableWidth = widths.reduce((sum, value) => sum + value, 0);
  const separator = withAlpha(env.styles.border, 0.6);

  const rowNodes: ReactNode[] = rows.map((row, rowIndex) => (
    <div key={rowIndex} style={{ display: "flex", flexDirection: "row", width: tableWidth, borderBottomWidth: 1, borderColor: separator }}>
      {Array.from({ length: columns }, (_, columnIndex) => {
        const cell = row[columnIndex];
        const cellWidth = widths[columnIndex]!;
        const style = cell?.header ? head : body;
        const padY = cell?.header ? HEAD_PAD_Y : CELL_PAD_Y;
        const inner = cellWidth - 2 * CELL_PAD_X;
        let content: ReactNode = null;
        if (cell) {
          if (wraps) {
            content = renderParagraph(cell.node.children as ElementContent[], inner, env, style, `c${rowIndex}:${columnIndex}`);
          } else {
            // One line per cell, truncated with an ellipsis (collapsed, or header cells).
            content = renderParagraph(cell.node.children as ElementContent[], Number.MAX_SAFE_INTEGER / 4, env, style, `c${rowIndex}:${columnIndex}`);
          }
        }
        return (
          <div
            key={columnIndex}
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: cell?.align === "right" ? "flex-end" : cell?.align === "center" ? "center" : "flex-start",
              width: cellWidth,
              flexShrink: 0,
              paddingLeft: CELL_PAD_X,
              paddingRight: CELL_PAD_X,
              paddingTop: padY,
              paddingBottom: padY,
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", width: inner, overflow: "hidden" }}>{content}</div>
          </div>
        );
      })}
    </div>
  ));

  const copyLabel = copied ? "Copied" : "Copy table";
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", marginTop }}>
      <div style={{ display: "flex", flexDirection: "row", width: "100%", overflowX: "scroll", scrollbarColor: palette.scrollbar }}>
        <div style={{ display: "flex", flexDirection: "column", width: tableWidth, flexShrink: 0 }}>{rowNodes}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2, userSelect: "none" }}>
        {clipped ? (
          <CodeBlockIconButton
            icon={expanded ? "minimize-2" : "maximize-2"}
            label={expanded ? "Collapse table cells" : "Expand table cells"}
            pressed={expanded}
            onClick={() => setExpanded((value) => !value)}
          />
        ) : (
          <div />
        )}
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          side="bottom"
          align="end"
          trigger={({ toggle }) => <CodeBlockIconButton icon={copied ? "check" : "copy"} label={copyLabel} onClick={toggle} />}
        >
          <MenuItem onSelect={() => copy(tableToMarkdown(rows))}>Copy as Markdown</MenuItem>
          <MenuItem onSelect={() => copy(tableToCsv(rows))}>Copy as CSV</MenuItem>
        </Menu>
      </div>
    </div>
  );
});
MARGIN_AWARE.add(MarkdownTable);
