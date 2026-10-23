// apps/web/src/components/chat/useRestingComposerControlsLayout.ts and
// restingComposerControlsMeasurement.ts: which footer control blocks show their labels,
// which drop to icon-only, and which move into the ⋯ overflow menu.
//
// Web reads the DOM (scrollWidth, getComputedStyle). gpuix only reports laid-out boxes through
// `onLayout`, a frame late, so every part reports its own width here instead: the host, the
// model picker trigger and its label (clipped and natural), each block, each label inside a
// block (labels of an icon-only block stay laid out, out of flow), and the overflow trigger.
// The numbers fed to `resolveRestingComposerControlsLayout` do not depend on the layout they
// produce, so the result settles in one pass instead of flipping between layouts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type RestingComposerControlsMeasurement,
  resolveRestingComposerControlsLayout,
} from "../../web/components/composerFooterLayout.ts";
import type { ModelPickerMeasurePart } from "./ProviderModelPicker.tsx";

export interface ComposerControlsLayout {
  readonly hiddenCount: number;
  readonly iconOnlyCount?: number;
  readonly visible: boolean;
}

export interface ComposerControlsMeasurer {
  /** The width the controls may use (the host's content box). */
  readonly host: (width: number) => void;
  readonly picker: (part: ModelPickerMeasurePart, width: number) => void;
  /** A block's laid-out width, and whether it was icon-only when laid out. `null` on unmount. */
  readonly block: (id: string, width: number | null, iconOnly: boolean) => void;
  readonly label: (blockId: string, key: string, width: number | null, gap: number) => void;
  readonly overflow: (width: number) => void;
}

interface BlockMeasurement {
  width: number | null;
  iconOnly: boolean;
  labels: Map<string, { width: number; gap: number }>;
}

export function useComposerControlsLayout(options: {
  /** Block ids in footer order (web restingBlockDefs). */
  readonly blockIds: ReadonlyArray<string>;
  /** Inline margins of the picker trigger (the expanded footer's `-ms-2.5`). */
  readonly pickerMarginInline: number;
  readonly pickerMinWidth: number;
  /** The picker shows no label (resting strip under 640px); its rendered width is its natural width. */
  readonly pickerLabelCollapsed?: boolean;
  /** The controls row's gap (web `gap-1`). */
  readonly gap: number;
}): { layout: ComposerControlsLayout; measure: ComposerControlsMeasurer } {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const store = useRef({
    host: null as number | null,
    picker: { control: null as number | null, label: null as number | null, labelNatural: null as number | null },
    blocks: new Map<string, BlockMeasurement>(),
    overflow: null as number | null,
  }).current;
  const [layout, setLayout] = useState<ComposerControlsLayout>({ hiddenCount: 0, visible: true });

  // Built inside the state updater: a frame's layout reports arrive as a batch, and resolving
  // against the half-reported store (a block before its labels) would leave a collapsed
  // `previous` behind that the promotion slack then refuses to undo.
  const readMeasurement = useCallback((): (RestingComposerControlsMeasurement & { hostWidth: number }) | null => {
    const { blockIds, pickerMarginInline, pickerMinWidth, pickerLabelCollapsed, gap } = optionsRef.current;
    const { picker } = store;
    if (store.host === null || picker.control === null) return null;
    const blockWidths: number[] = [];
    const iconOnlyBlockWidths: number[] = [];
    for (const id of blockIds) {
      const block = store.blocks.get(id);
      if (!block || block.width === null) return null;
      let labels = 0;
      for (const label of block.labels.values()) labels += label.width + label.gap;
      // controlBlockWidths: labels of an icon-only block are out of flow, so add them back for
      // the natural width; labels in flow come off for the icon-only width.
      const natural = block.iconOnly ? block.width + labels : block.width;
      const iconOnly = block.iconOnly ? block.width : block.width - labels;
      blockWidths.push(natural);
      iconOnlyBlockWidths.push(Math.min(natural, iconOnly));
    }
    // providerModelPickerNaturalWidth: the rendered trigger plus whatever its label clips.
    const hiddenLabelWidth =
      !pickerLabelCollapsed && picker.label !== null && picker.labelNatural !== null
        ? Math.max(0, picker.labelNatural - picker.label)
        : 0;
    return {
      gap,
      naturalFixedWidth: picker.control + hiddenLabelWidth + pickerMarginInline,
      minimumFixedWidth: pickerMinWidth + pickerMarginInline,
      blockWidths,
      overflowWidth: store.overflow ?? 0,
      iconOnlyBlockWidths,
      hostWidth: store.host,
    };
  }, [store]);

  // The 1px promotion slack absorbs the picker's sub-pixel jitter at a fixed host width. After the
  // host itself resizes, resolve from scratch: a transient squeeze (gpuix lays the chat column out
  // a few px wide for a frame while the right panel opens) would otherwise leave the bar a step
  // more collapsed than the same width reached by narrowing.
  const resolvedHostRef = useRef<number | null>(null);
  const recompute = useCallback(() => {
    setLayout((current) => {
      const measurement = readMeasurement();
      if (!measurement) return current;
      const sameHost =
        resolvedHostRef.current !== null && Math.abs(resolvedHostRef.current - measurement.hostWidth) <= 0.5;
      resolvedHostRef.current = measurement.hostWidth;
      const next = resolveRestingComposerControlsLayout({
        ...measurement,
        ...(sameHost ? { previous: current } : {}),
      });
      return next.hiddenCount === current.hiddenCount &&
        next.iconOnlyCount === current.iconOnlyCount &&
        next.visible === current.visible
        ? current
        : next;
    });
  }, [readMeasurement]);

  const measure = useMemo<ComposerControlsMeasurer>(() => {
    const blockFor = (id: string) => {
      let block = store.blocks.get(id);
      if (!block) {
        block = { width: null, iconOnly: false, labels: new Map() };
        store.blocks.set(id, block);
      }
      return block;
    };
    const changed = (previous: number | null, next: number) => previous === null || Math.abs(previous - next) > 0.25;
    return {
      host: (width) => {
        if (!changed(store.host, width)) return;
        store.host = width;
        recompute();
      },
      picker: (part, width) => {
        if (!changed(store.picker[part], width)) return;
        store.picker[part] = width;
        recompute();
      },
      block: (id, width, iconOnly) => {
        const block = blockFor(id);
        if (width === null) {
          block.width = null;
          return;
        }
        if (!changed(block.width, width) && block.iconOnly === iconOnly) return;
        block.width = width;
        block.iconOnly = iconOnly;
        recompute();
      },
      label: (blockId, key, width, gap) => {
        const labels = blockFor(blockId).labels;
        if (width === null) {
          if (labels.delete(key)) recompute();
          return;
        }
        const previous = labels.get(key);
        if (previous && !changed(previous.width, width) && previous.gap === gap) return;
        labels.set(key, { width, gap });
        recompute();
      },
      overflow: (width) => {
        if (!changed(store.overflow, width)) return;
        store.overflow = width;
        recompute();
      },
    };
  }, [store, recompute]);

  // A block appearing or leaving (traits for a model without them) changes the step count.
  const blockKey = options.blockIds.join(" ");
  useEffect(() => {
    recompute();
  }, [blockKey, options.pickerMarginInline, options.pickerLabelCollapsed, recompute]);

  return { layout, measure };
}
