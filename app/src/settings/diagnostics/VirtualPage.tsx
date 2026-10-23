// SettingsVirtualPage (settings/layout.tsx) plus one thing Diagnostics needs:
// scrolling an item into the list when a settings search result points at it.
// A virtual list only mounts items near the viewport, so a section at the
// bottom ("OpenTelemetry export") never mounts and its own search-target hook
// never runs. This brings it into view; the section then highlights itself
// and clears the target as usual.
import { useGpuixRequired } from "@gpuix/react";
import { useEffect, useRef, type ReactNode } from "react";

import { SettingsScopeSentence, type SettingsVirtualItem } from "../layout.tsx";

export function TargetedVirtualPage({
  items,
  maxWidth = 896,
  targetKey,
}: {
  items: ReadonlyArray<SettingsVirtualItem>;
  maxWidth?: number;
  /** The key of an item to scroll into view, or null. */
  targetKey: string | null;
}) {
  const renderer = useGpuixRequired();
  const listRef = useRef<{ id: number } | null>(null);
  // +1: the scope sentence is the list's first row.
  const found = targetKey === null ? -1 : items.findIndex((item) => item.key === targetKey);
  const targetIndex = found < 0 ? -1 : found + 1;
  useEffect(() => {
    if (targetIndex < 1 || !listRef.current) return;
    renderer.scrollToItem?.(listRef.current.id, targetIndex, -24);
  }, [targetIndex, renderer]);

  const column = (key: string, node: ReactNode, paddingTop: number, paddingBottom = 0) => (
    <div key={key} style={{ display: "flex", flexDirection: "row", justifyContent: "center", width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth, paddingLeft: 24, paddingRight: 24, paddingTop, paddingBottom }}>
        {node}
      </div>
    </div>
  );
  return (
    <div testId="settings-page-scroll" style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <virtual-list ref={listRef as never} overdraw={900} style={{ flexGrow: 1, minHeight: 0 }}>
        {[
          column("scope", <SettingsScopeSentence />, 24),
          ...items.map((item, index) => column(item.key, item.node, item.gapBefore ?? 32, index === items.length - 1 ? 48 : 0)),
        ]}
      </virtual-list>
    </div>
  );
}
