// apps/web/src/components/chat/ComposerControlsBar.tsx: the model picker, then the collapsible
// blocks (traits, mode), then the ⋯ overflow menu for blocks that do not fit. The same bar
// renders in the expanded footer (sm) and the resting strip (xs); the layout comes from
// `useComposerControlsLayout`, which steps through: last block icon-only, every block
// icon-only, then blocks into the overflow menu from the last one back.
import { type ReactNode, useCallback, useEffect, useMemo } from "react";

import {
  COMPOSER_CONTROL_HIDDEN_STYLE,
  ComposerControlBlockContext,
  type ComposerControlBlockState,
} from "./ComposerControl.tsx";
import type { ComposerControlsLayout, ComposerControlsMeasurer } from "./useComposerControlsLayout.ts";

export interface ComposerControlBlockDef {
  readonly id: string;
  readonly content: ReactNode;
}

/** Ids of the blocks the layout moved into the overflow menu (web hiddenRestingBlockIds). */
export function hiddenComposerControlBlockIds(
  blockIds: ReadonlyArray<string>,
  layout: ComposerControlsLayout,
): ReadonlyArray<string> {
  return layout.hiddenCount > 0 ? blockIds.slice(blockIds.length - layout.hiddenCount) : [];
}

export function ComposerControlsBar(props: {
  picker: ReactNode;
  blocks: ReadonlyArray<ComposerControlBlockDef>;
  layout: ComposerControlsLayout;
  measure: ComposerControlsMeasurer;
  /** Shown once a block is hidden; until then it stays mounted out of flow so its width is known. */
  overflowMenu: ReactNode;
}) {
  const { blocks, layout, measure } = props;
  const hiddenCount = layout.hiddenCount;
  const iconOnlyCount = layout.iconOnlyCount ?? 0;
  return (
    <>
      {props.picker}
      {blocks.map((block, index) => (
        <ControlBlock
          key={block.id}
          id={block.id}
          measure={measure}
          iconOnly={index >= blocks.length - iconOnlyCount}
          hidden={index >= blocks.length - hiddenCount}
        >
          {block.content}
        </ControlBlock>
      ))}
      <div
        testId="composer-controls-overflow-slot"
        onLayout={(event) => {
          const width = (event as { width?: number }).width;
          if (typeof width === "number") measure.overflow(width);
        }}
        style={{
          display: "flex",
          flexShrink: 0,
          minWidth: 0,
          ...(hiddenCount === 0 ? COMPOSER_CONTROL_HIDDEN_STYLE : {}),
        }}
      >
        {props.overflowMenu}
      </div>
    </>
  );
}

/** web `data-resting-block`: `flex w-max min-w-max shrink-0 items-center gap-1`. */
function ControlBlock(props: {
  id: string;
  measure: ComposerControlsMeasurer;
  iconOnly: boolean;
  hidden: boolean;
  children: ReactNode;
}) {
  const { id, measure, iconOnly } = props;
  const reportLabel = useCallback(
    (key: string, width: number | null, gap: number) => measure.label(id, key, width, gap),
    [measure, id],
  );
  const state = useMemo<ComposerControlBlockState>(() => ({ iconOnly, reportLabel }), [iconOnly, reportLabel]);
  useEffect(() => () => measure.block(id, null, false), [measure, id]);
  return (
    <div
      onLayout={(event) => {
        const width = (event as { width?: number }).width;
        if (typeof width === "number") measure.block(id, width, iconOnly);
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        ...(props.hidden ? COMPOSER_CONTROL_HIDDEN_STYLE : {}),
      }}
    >
      <ComposerControlBlockContext.Provider value={state}>{props.children}</ComposerControlBlockContext.Provider>
    </div>
  );
}
