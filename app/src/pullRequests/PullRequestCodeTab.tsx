// A reduced port of apps/web/src/components/pullRequest/PullRequestCodeTab.tsx. Web renders each
// file with @pierre/diffs under its own header (viewed toggle, inline review threads, line
// selection for agents). Here the whole patch goes to one native gpuix <diff>, which draws its
// own file headers; files start folded like web's default (`diffFilesCollapsed`). Kept: the
// commit scope menu, the files/viewed counts, fold all/unfold all, paging through diff slices.
// Left out: marking files viewed and review comments (host writes), split layout, word wrap,
// whitespace toggle and the file tree.
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { pullRequestEnvironment, useEnvironmentQuery } from "../state/pullRequests.ts";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem, Tooltip } from "../ui/overlay.tsx";
import { IconButton, Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { orderDiffFiles } from "../web/components/pullRequest/pullRequestFileOrder.logic.ts";
import type { PullRequestDetailView } from "./PullRequestDetailPanel.tsx";
import { GhostBar, PullRequestsUnavailableState } from "./PullRequestListStates.tsx";
import { OutlineButton } from "./PullRequestMenus.tsx";

interface PatchFile {
  readonly name: string;
  readonly text: string;
  readonly additionLines: ReadonlyArray<string>;
  readonly deletionLines: ReadonlyArray<string>;
}

/** Splits a unified patch at each `diff --git` header. */
function splitPatch(patch: string): ReadonlyArray<PatchFile> {
  const chunks = patch.split(/^(?=diff --git )/mu).filter((chunk) => chunk.startsWith("diff --git "));
  return chunks.map((text) => {
    const header = /^diff --git a\/(.+?) b\/(.+)$/mu.exec(text);
    const lines = text.split("\n");
    return {
      name: header?.[2] ?? header?.[1] ?? "",
      text,
      additionLines: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")),
      deletionLines: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")),
    };
  });
}

function DiffSlice({
  environmentId,
  input,
  isCollapsed,
  onToggleFile,
  onPaths,
  onNext,
}: {
  environmentId: EnvironmentId;
  input: PullRequestRef & { readonly cursor?: string; readonly commit?: string };
  isCollapsed: (path: string) => boolean;
  onToggleFile: (path: string) => void;
  onPaths: (paths: ReadonlyArray<string>) => void;
  onNext: ((cursor: string) => void) | null;
}) {
  const theme = useTheme();
  const query = useEnvironmentQuery(pullRequestEnvironment.diff({ environmentId, input }));
  const patch = query.data?.patch ?? null;
  // Web orders files the way a reader takes them in: sources by import order, then their tests,
  // then generated files.
  const files = useMemo(() => (patch === null ? [] : orderDiffFiles(splitPatch(patch))), [patch]);
  useEffect(() => {
    if (patch !== null) onPaths(files.map((file) => file.name));
    // oxlint-disable-next-line react/exhaustive-deps -- report once per patch
  }, [files]);
  if (query.error && query.data === null) {
    return <PullRequestsUnavailableState title="Diff unavailable" error={query.error} onRetry={query.refresh} />;
  }
  if (query.data === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
        <Text size="xs" color={theme.mutedForeground}>
          Loading pull request diff...
        </Text>
        <GhostBar width="70%" height={14} />
        <GhostBar width="55%" height={14} />
      </div>
    );
  }
  const paths = files.map((file) => file.name);
  return (
    <>
      <diff
        patch={files.map((file) => file.text).join("")}
        collapsedPaths={paths.filter(isCollapsed)}
        onToggleFile={(event) => {
          if (event.value) onToggleFile(event.value);
        }}
        theme={{
          appearance: theme.appearance,
          bg: theme.background,
          text: theme.foreground,
          fontSans: FONTS.sans,
          fontMono: FONTS.mono,
        }}
        style={{ minWidth: 0 }}
      />
      {query.data.truncated ? (
        <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8 }}>
          <Text size="xs" color={theme.mutedForeground}>
            Some files in this slice are too large or binary to show here.
          </Text>
        </div>
      ) : null}
      {query.data.nextCursor && onNext ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 12 }}>
          <OutlineButton height={28} onClick={() => onNext(query.data!.nextCursor!)}>
            <Text weight={500}>Load more files</Text>
          </OutlineButton>
        </div>
      ) : null}
    </>
  );
}

export function PullRequestCodeTab({
  environmentId,
  reference,
  detail,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
}) {
  const theme = useTheme();
  const [commit, setCommit] = useState<string | null>(null);
  const [cursors, setCursors] = useState<ReadonlyArray<string>>([]);
  const [paths, setPaths] = useState<ReadonlyMap<string, ReadonlyArray<string>>>(new Map());
  // `folded` is the default for every file; `toggled` lists the files flipped from it.
  const [folded, setFolded] = useState(true);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const viewed = useEnvironmentQuery(
    detail.capabilities.viewedFiles !== undefined ? pullRequestEnvironment.filesViewed({ environmentId, input: reference }) : null,
  ).data;
  const allPaths = [...paths.values()].flat();
  const viewedCount = viewed ? allPaths.filter((path) => viewed.files.some((file) => file.path === path && file.state === "viewed")).length : 0;
  const fileCount = commit === null ? detail.changedFiles : allPaths.length;
  const isCollapsed = (path: string) => (folded ? !toggled.has(path) : toggled.has(path));
  const selectedCommit = detail.commits.find((candidate) => candidate.oid === commit) ?? null;
  const resetScope = (next: string | null) => {
    setCommit(next);
    setCursors([]);
    setPaths(new Map());
    setToggled(new Set());
  };
  const slices = [undefined, ...cursors];
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 40,
          paddingLeft: 12,
          paddingRight: 12,
          borderBottomWidth: 1,
          borderColor: alpha(theme.border, 0.6),
          flexShrink: 0,
        }}
      >
        <Menu
          minWidth={280}
          maxHeight={360}
          trigger={({ toggle }) => (
            <div
              testId="pr-code-commits"
              onClick={toggle}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                height: 24,
                paddingLeft: 7,
                paddingRight: 7,
                borderRadius: RADIUS.md,
                cursor: "pointer",
                maxWidth: 240,
                hover: { backgroundColor: theme.accent },
              }}
            >
              <Text size="xs" weight={600} truncate>
                {selectedCommit ? (selectedCommit.messageHeadline ?? selectedCommit.oid.slice(0, 7)) : "All commits"}
              </Text>
              <Icon name="chevron-down" size={14} color={theme.mutedForeground} />
            </div>
          )}
        >
          <MenuItem checked={commit === null} onSelect={() => resetScope(null)}>
            All commits
          </MenuItem>
          {detail.commits.map((entry) => (
            <MenuItem key={entry.oid} checked={commit === entry.oid} onSelect={() => resetScope(entry.oid)}>
              {`${entry.oid.slice(0, 7)} ${entry.messageHeadline ?? ""}`}
            </MenuItem>
          ))}
        </Menu>
        <Text size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
          {`${fileCount.toLocaleString()} ${fileCount === 1 ? "file" : "files"}`}
        </Text>
        {viewed ? (
          <Text size="xs" color={theme.mutedForeground} style={{ whiteSpace: "nowrap" }}>
            {`· ${viewedCount} / ${fileCount} viewed`}
          </Text>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        <Tooltip content={folded && toggled.size === 0 ? "Expand all files" : "Collapse all files"}>
          <div style={{ display: "flex" }}>
            <IconButton
              icon={folded && toggled.size === 0 ? "chevrons-up-down" : "chevrons-down-up"}
              onClick={() => {
                setFolded(!(folded && toggled.size === 0));
                setToggled(new Set());
              }}
              testId="pr-code-fold"
            />
          </div>
        </Tooltip>
      </div>
      <div
        testId="pr-code-scroll"
        style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", scrollbarColor: theme.scrollbar }}
      >
        {slices.map((cursor, index) => (
          <DiffSlice
            key={`${commit ?? "all"}:${cursor ?? "first"}`}
            environmentId={environmentId}
            input={{
              ...reference,
              ...(cursor === undefined ? {} : { cursor }),
              ...(commit === null ? {} : { commit }),
            }}
            isCollapsed={isCollapsed}
            onPaths={(slicePaths) =>
              setPaths((current) => new Map(current).set(cursor ?? "", slicePaths))
            }
            onToggleFile={(path) =>
              setToggled((current) => {
                const next = new Set(current);
                if (next.has(path)) next.delete(path);
                else next.add(path);
                return next;
              })
            }
            onNext={index === slices.length - 1 ? (next) => setCursors((current) => [...current, next]) : null}
          />
        ))}
        <div style={{ height: 48, flexShrink: 0 }} />
      </div>
    </div>
  );
}
