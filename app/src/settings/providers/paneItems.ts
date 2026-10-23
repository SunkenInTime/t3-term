import type { ReactNode } from "react";

/** One item of the detail pane's virtual list. `gapBefore` is the space above it. */
export interface PaneItem {
  readonly key: string;
  readonly node: ReactNode;
  readonly gapBefore?: number;
}
