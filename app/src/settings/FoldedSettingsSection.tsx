// Port of apps/web/src/components/settings/FoldedSettingsSection.tsx with the header
// inside the group: a chevron, the title and a one-line summary fold the rows below.
// The `outside` placement is not used by the pages that import this.
import { useAtomValue } from "@effect/atom-react";
import { useState, type ReactNode } from "react";

import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { alpha, useTheme } from "../ui/theme.ts";
import { SettingsGroup, settingsSearchTargetAtom, useSettingsInset, useSettingsSearchTarget } from "./layout.tsx";

export function FoldedSettingsSection({
  id,
  title,
  summary,
  control,
  testId,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly summary?: string | null;
  readonly control?: ReactNode;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  const theme = useTheme();
  const inset = useSettingsInset();
  const [open, setOpen] = useState(false);
  const { ref } = useSettingsSearchTarget(id);
  // A search jump lands inside the fold, so open it before the scroll runs.
  const target = useAtomValue(settingsSearchTargetAtom);
  const [openedForNonce, setOpenedForNonce] = useState<number | null>(null);
  if (target?.id === id && openedForNonce !== target.nonce) {
    setOpenedForNonce(target.nonce);
    if (!open) setOpen(true);
  }
  return (
    <div ref={ref as never} testId={`settings-section-${id}`} style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      <SettingsGroup divided={false}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16, paddingLeft: inset, paddingRight: inset }}>
          <div
            testId={testId ?? `${id}-toggle`}
            onClick={() => setOpen(!open)}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              minHeight: 44,
              paddingTop: 8,
              paddingBottom: 8,
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
              cursor: "pointer",
            }}
          >
            <Icon name={open ? "chevron-down" : "chevron-right"} size={16} color={theme.mutedForeground} />
            <Text weight={500} style={{ flexShrink: 0 }}>
              {title}
            </Text>
            {summary ? (
              <Text size="xs" color={theme.mutedForeground} truncate>
                {summary}
              </Text>
            ) : null}
          </div>
          {control ? <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexShrink: 0 }}>{control}</div> : null}
        </div>
        {open ? (
          <div style={{ display: "flex", flexDirection: "column", width: "100%", borderTopWidth: 1, borderColor: alpha(theme.border, 0.5) }}>
            {dividedRows(children, alpha(theme.border, 0.5))}
          </div>
        ) : null}
      </SettingsGroup>
    </div>
  );
}

/** `[&>*+*]:border-t [&>*+*]:border-border/50` */
function dividedRows(children: ReactNode, color: string): ReactNode {
  const items = (Array.isArray(children) ? children.flat(Infinity) : [children]).filter(
    (child) => child !== null && child !== undefined && child !== false && child !== "",
  ) as ReactNode[];
  return items.map((child, index) => (
    <div
      key={(child as { key?: string | null })?.key ?? index}
      style={{ display: "flex", flexDirection: "column", width: "100%", ...(index > 0 ? { borderTopWidth: 1, borderColor: color } : {}) }}
    >
      {child}
    </div>
  ));
}
