// Port of apps/web/src/components/files/DelimitedTablePreview.tsx: a CSV/TSV file as a
// table (first 100 rows, 30 columns, via @t3tools/shared/delimitedPreview).
//
// The web table sizes its columns with the browser's auto table layout (each column as
// wide as its widest cell, max-w-80). gpuix has no table layout, so column widths come
// from the longest cell in characters at the xs sans size, clamped the same way; cells
// that hit the cap wrap like web's whitespace-pre-wrap break-words cells. The header row
// stays put while the body scrolls (web's sticky thead), and both pan together sideways.
import type { EventPayload } from "@gpuix/native";
import { parseDelimitedPreview } from "@t3tools/shared/delimitedPreview";
import { memo, useMemo, useState } from "react";

import { FONTS, alpha, useTheme } from "../../ui/theme.ts";
import { FileSurfaceNotice } from "./fileSurfaceChrome.tsx";

/** max-w-80 */
const MAX_COLUMN_WIDTH = 320;
const MIN_COLUMN_WIDTH = 40;
/** px-3 on each side. */
const CELL_PADDING_X = 12;
/** Average advance of the xs (12px) sans face, for column sizing. */
const SANS_CHAR_WIDTH = 6.6;

function columnWidths(rows: ReadonlyArray<ReadonlyArray<string>>): number[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      const longestLine = cell.split(/\r?\n/).reduce((max, line) => Math.max(max, line.length), 0);
      const width = Math.ceil(longestLine * SANS_CHAR_WIDTH) + CELL_PADDING_X * 2;
      widths[index] = Math.max(widths[index] ?? MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width));
    });
  }
  return widths;
}

const TableRow = memo(function TableRow(props: {
  cells: ReadonlyArray<string>;
  widths: ReadonlyArray<number>;
  header: boolean;
  striped: boolean;
  scrollX: number;
}) {
  const theme = useTheme();
  const background = props.header
    ? alpha(theme.muted, 0.6)
    : props.striped
      ? alpha(theme.muted, 0.3)
      : "#00000000";
  return (
    <div style={{ display: "flex", flexDirection: "row", flexShrink: 0, marginLeft: -props.scrollX, backgroundColor: background }}>
      {props.widths.map((width, index) => (
        <div
          key={index}
          style={{
            width,
            flexShrink: 0,
            paddingLeft: CELL_PADDING_X,
            paddingRight: CELL_PADDING_X,
            paddingTop: 6,
            paddingBottom: 6,
            borderBottomWidth: 1,
            borderColor: props.header ? theme.border : alpha(theme.border, 0.6),
          }}
        >
          <text
            style={{
              color: theme.foreground,
              fontSize: 12,
              lineHeight: 16,
              fontFamily: FONTS.sans,
              ...(props.header ? { fontWeight: 500 } : {}),
            }}
          >
            {props.cells[index] ?? ""}
          </text>
        </div>
      ))}
    </div>
  );
});

export function DelimitedTablePreview(props: { readonly name: string; readonly text: string; readonly delimiter: "," | "\t" }) {
  const theme = useTheme();
  const table = useMemo(() => parseDelimitedPreview(props.text, props.delimiter), [props.text, props.delimiter]);
  const widths = useMemo(() => columnWidths(table.rows), [table.rows]);
  const [header, ...body] = table.rows;
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const contentWidth = widths.reduce((sum, width) => sum + width, 0);
  const maxScrollX = Math.max(0, contentWidth - viewportWidth);
  const clampedScrollX = Math.min(scrollX, maxScrollX);
  return (
    <div testId="files-table" aria-label={props.name} style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, minWidth: 0 }}>
      {table.truncated ? (
        <FileSurfaceNotice>Table limited to the first 100 rows and 30 columns. Switch to source for the rest.</FileSurfaceNotice>
      ) : null}
      <div
        onLayout={(event) => {
          const width = Math.floor(Number(event.width ?? 0));
          if (width > 0 && width !== viewportWidth) setViewportWidth(width);
        }}
        onScroll={(event: EventPayload) => {
          const deltaX = Number(event.deltaX ?? 0);
          if (deltaX !== 0) setScrollX((current) => Math.max(0, Math.min(maxScrollX, current - deltaX)));
        }}
        style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden" }}
      >
        {header ? <TableRow cells={header} widths={widths} header striped={false} scrollX={clampedScrollX} /> : null}
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar }}>
          {body.map((row, index) => (
            // even:bg-muted/30 counts rows from 1.
            <TableRow key={index} cells={row} widths={widths} header={false} striped={index % 2 === 1} scrollX={clampedScrollX} />
          ))}
        </div>
      </div>
    </div>
  );
}
