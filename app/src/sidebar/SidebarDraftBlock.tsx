// apps/web/src/components/sidebar/SidebarDraftBlock.tsx: unsent composer drafts
// that have no server thread yet, above the thread list. The composer
// publishes them through sidebarDraftsAtom (state/sidebar.ts).
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { memo, useState } from "react";

import {
  projectByKeyAtom,
  projectDisplayNameByKeyAtom,
  sidebarContextMenuAtom,
  sidebarDraftDiscardAtom,
  sidebarDraftsAtom,
  type SidebarDraftEntry,
} from "../state/sidebar.ts";
import { routeAtom } from "../state/ui.ts";
import { draftIdOfKey } from "../state/composer.ts";
import { Icon } from "../ui/Icon.tsx";
import { Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { claimClick, consumeClaimedClick } from "./clickGuard.ts";
import { ProjectFavicon } from "./ProjectFavicon.tsx";

const SidebarDraftRow = memo(function SidebarDraftRow({
  draft,
  isActive,
}: {
  draft: SidebarDraftEntry;
  isActive: boolean;
}) {
  const theme = useTheme();
  const projectKey = `${draft.environmentId}:${draft.projectId}`;
  const project = useAtomValue(projectByKeyAtom).get(projectKey) ?? null;
  const projectDisplayName = useAtomValue(projectDisplayNameByKeyAtom).get(projectKey) ?? null;
  const discard = useAtomValue(sidebarDraftDiscardAtom);
  const setRoute = useAtomSet(routeAtom);
  const setContextMenu = useAtomSet(sidebarContextMenuAtom);
  const [hovered, setHovered] = useState(false);
  const [discardHovered, setDiscardHovered] = useState(false);
  return (
    <div style={{ paddingTop: 2, paddingBottom: 2, flexShrink: 0 }}>
      <div
        testId="sidebar-draft-row"
        onClick={() => {
          if (consumeClaimedClick()) return;
          const draftId = draftIdOfKey(draft.draftId);
          setRoute({ kind: "draft", environmentId: draft.environmentId, projectId: draft.projectId, ...(draftId ? { draftId } : {}) });
        }}
        onAuxClick={(event) => setContextMenu({ kind: "draft", draftId: draft.draftId, x: event.x ?? 0, y: event.y ?? 0 })}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          flexDirection: "column",
          height: 78,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 10,
          paddingRight: 10,
          borderRadius: RADIUS.md,
          backgroundColor: isActive
            ? theme.sidebar.rowActive
            : alpha(theme.warning, hovered ? 0.08 : 0.04),
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, height: 20, minWidth: 0 }}>
          <Icon name="square-pen" size={12} color={theme.warningForeground} />
          {project ? <ProjectFavicon project={project} size={16} /> : null}
          <Text size="xs" weight={500} color={theme.mutedForeground} truncate style={{ flexGrow: 1, flexShrink: 1 }}>
            {projectDisplayName ?? ""}
          </Text>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", height: 20, minWidth: 20, flexShrink: 0 }}>
            {hovered && discard ? (
              <Tooltip content="Discard draft" side="top">
                <div
                  onMouseDown={claimClick}
                  onClick={() => discard.discardDraft(draft.draftId)}
                  onMouseEnter={() => setDiscardHovered(true)}
                  onMouseLeave={() => setDiscardHovered(false)}
                  style={{ display: "flex", alignItems: "center", height: 20, paddingLeft: 4, paddingRight: 4, borderRadius: RADIUS.sm, cursor: "pointer" }}
                >
                  <Icon name="x" size={12} color={discardHovered ? theme.foreground : theme.mutedForeground} />
                </div>
              </Tooltip>
            ) : null}
          </div>
        </div>
        <Text size="sm" weight={500} color={alpha(theme.foreground, 0.9)} truncate style={{ marginTop: 2 }}>
          {draft.preview}
        </Text>
      </div>
    </div>
  );
});

export function SidebarDraftBlock({ scopedProjectKeys }: { scopedProjectKeys: ReadonlySet<string> | null }) {
  const theme = useTheme();
  const drafts = useAtomValue(sidebarDraftsAtom);
  const route = useAtomValue(routeAtom);
  const visible = drafts
    .filter(
      (draft) =>
        scopedProjectKeys === null || scopedProjectKeys.has(`${draft.environmentId}:${draft.projectId}`),
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((draft) => (
        <SidebarDraftRow
          key={draft.draftId}
          draft={draft}
          isActive={
            route.kind === "draft" &&
            route.environmentId === draft.environmentId &&
            route.projectId === draft.projectId &&
            route.draftId === draftIdOfKey(draft.draftId)
          }
        />
      ))}
      <div
        testId="sidebar-draft-divider"
        style={{ height: 1, marginLeft: 10, marginRight: 10, marginTop: 6, marginBottom: 6, flexShrink: 0, backgroundColor: alpha(theme.sidebar.border, 0.6) }}
      />
    </>
  );
}
