// Port of apps/web/src/components/pullRequest/PullRequestThreadLinks.tsx: the threads a pull request
// is linked from. "count" is the header's message-square button (opens the command palette on the
// pull request's URL), "menu-item" the overflow menu's Link/Unlink row, and "picker" the dialog
// that chooses a thread to link. Linking changes the thread on the T3 server, not the host.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { threadPullRequestLinkMode } from "@t3tools/client-runtime/thread-pull-request-compatibility";
import type { EnvironmentId, PullRequestRef, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { normalizeThreadPullRequestKey } from "@t3tools/shared/threadPullRequests";
import { useState } from "react";

import { usePullRequestLinking } from "../dialogs/usePullRequestLinking.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentProjects, environmentThreadShells } from "../state/environment.ts";
import { openCommandPalette } from "../state/palette.ts";
import { pullRequestEnvironment, pullRequestEnvironmentsAtom, useEnvironmentQuery } from "../state/pullRequests.ts";
import { Icon } from "../ui/Icon.tsx";
import { Dialog, Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { toast } from "../ui/toast.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { PrButton } from "./prControls.tsx";
import { PrMenuItem } from "./PullRequestMenus.tsx";
import { PullRequestGlyph } from "./pullRequestPresentation.tsx";
import { guardPullRequestWrite, PullRequestDryRunError } from "./pullRequestWrites.ts";

interface PullRequestThreadLinksProps {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  url: string;
  threadRef: ScopedThreadRef | null;
  display: "count" | "menu-item" | "picker";
  onPickerOpenChange?: (open: boolean) => void;
}

export function PullRequestThreadLinks(props: PullRequestThreadLinksProps) {
  const environments = useAtomValue(pullRequestEnvironmentsAtom);
  const capabilities = environments.find((entry) => entry.environmentId === props.environmentId)?.serverConfig
    ?.environment.capabilities;
  if (threadPullRequestLinkMode(capabilities) === "unsupported") return null;
  return <EnabledPullRequestThreadLinks key={`${props.environmentId}:${props.url}`} {...props} />;
}

function EnabledPullRequestThreadLinks({
  environmentId,
  reference,
  url,
  threadRef,
  display,
  onPickerOpenChange,
}: PullRequestThreadLinksProps) {
  const theme = useTheme();
  const parsed = parseChangeRequestUrl(url);
  const thread = useAtomValue(
    environmentThreadShells.threadShellAtom(
      threadRef?.environmentId === environmentId ? threadRef : scopeThreadRef(environmentId, "__none__" as ThreadId),
    ),
  );
  const currentThreadRef = thread === null ? null : threadRef;
  const linking = usePullRequestLinking(environmentId);
  const linkedHere = linking.isLinked(thread, url);
  const relationsInput =
    parsed === null ? reference : { ...reference, ...normalizeThreadPullRequestKey(parsed) };
  const relations = useEnvironmentQuery(
    linking.mode === "multiple" && display !== "menu-item"
      ? pullRequestEnvironment.linkedThreads({ environmentId, input: relationsInput })
      : null,
  );
  // Refreshes can briefly clear the value; keep the last answer so the count does not blink.
  const [lastRelations, setLastRelations] = useState(relations.data);
  if (relations.data !== null && relations.data !== lastRelations) setLastRelations(relations.data);
  const [pending, setPending] = useState(false);

  const changeLink = async (threadId: ThreadId, remove: boolean) => {
    if (parsed === null || pending) return;
    setPending(true);
    const target = scopeThreadRef(environmentId, threadId);
    const result = await settlePromise(() =>
      guardPullRequestWrite("thread pull request link", { threadRef: target, url, linked: !remove }, () =>
        linking.changeLink(target, url, !remove),
      ),
    );
    setPending(false);
    const failure =
      result._tag === "Failure"
        ? squashAtomCommandFailure(result)
        : result.value instanceof PullRequestDryRunError
          ? result.value
          : null;
    if (failure !== null) {
      toast({
        type: "error",
        title: remove ? "Could not unlink the pull request" : "Could not link the pull request",
        description: failure instanceof Error ? failure.message : String(failure),
      });
      return;
    }
    if (linking.mode === "multiple") {
      appAtomRegistry.refresh(pullRequestEnvironment.linkedThreads({ environmentId, input: relationsInput }));
    }
    onPickerOpenChange?.(false);
  };

  if (parsed === null || (!linkedHere && !linking.canLink(url))) return null;
  const linkedThreads = linking.mode === "multiple" ? ((relations.data ?? lastRelations)?.threads ?? []) : [];
  const linkedThreadsLabel =
    linkedThreads.length > 0
      ? `Linked from ${linkedThreads.length} ${linkedThreads.length === 1 ? "thread" : "threads"}`
      : "Linked threads";
  return (
    <>
      {display === "count" && (linkedThreads.length > 0 || relations.error !== null) ? (
        <Tooltip content={`${linkedThreadsLabel}. Search in the command palette.`}>
          <div style={{ display: "flex" }}>
            <PrButton
              variant="ghost"
              icon="message-square"
              testId="pr-linked-threads"
              onClick={() =>
                openCommandPalette({
                  query: url,
                  ...((relations.data ?? lastRelations) === null
                    ? {}
                    : { linkedThreads: { environmentId, threads: linkedThreads } }),
                })
              }
            >
              <text style={{ color: theme.foreground, fontSize: 12, lineHeight: 16, fontWeight: 500, fontFamily: FONTS.sans }}>
                {String(linkedThreads.length || "?")}
              </text>
            </PrButton>
          </div>
        </Tooltip>
      ) : null}
      {display === "menu-item" ? (
        <PrMenuItem
          icon={linkedHere ? PullRequestGlyph.unlink : PullRequestGlyph.link}
          disabled={pending}
          testId="pr-menu-link-thread"
          onSelect={() => {
            if (currentThreadRef !== null) void changeLink(currentThreadRef.threadId, linkedHere);
            else onPickerOpenChange?.(true);
          }}
        >
          {linkedHere ? "Unlink from this thread" : currentThreadRef ? "Link to this thread" : "Link to thread"}
        </PrMenuItem>
      ) : null}
      {display === "picker" ? (
        <Dialog open onOpenChange={(open) => onPickerOpenChange?.(open)} width={448} testId="pr-link-thread-dialog">
          <ThreadPicker environmentId={environmentId} url={url} pending={pending} onSelect={(threadId) => void changeLink(threadId, false)} />
        </Dialog>
      ) : null}
    </>
  );
}

function ThreadPicker({
  environmentId,
  url,
  pending,
  onSelect,
}: {
  environmentId: EnvironmentId;
  url: string;
  pending: boolean;
  onSelect: (threadId: ThreadId) => void;
}) {
  const theme = useTheme();
  const threads = useAtomValue(environmentThreadShells.navigationThreadShellsAtom);
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const linking = usePullRequestLinking(environmentId);
  const [query, setQuery] = useState("");
  const projectNames = new Map(
    projects.filter((project) => project.environmentId === environmentId).map((project) => [project.id, project.title]),
  );
  const search = query.trim().toLocaleLowerCase();
  const candidates = threads
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.archivedAt === null &&
        `${thread.title} ${projectNames.get(thread.projectId) ?? ""}`.toLocaleLowerCase().includes(search),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div style={{ display: "flex", flexDirection: "column", marginLeft: -24, marginRight: -24, marginTop: -24, marginBottom: -24 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 44,
          paddingLeft: 14,
          paddingRight: 14,
          borderBottomWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Icon name="search" size={16} color={alpha(theme.mutedForeground, 0.8)} />
        <input
          testId="pr-link-thread-search"
          autoFocus
          value={query}
          readOnly={pending}
          placeholder="Search threads or projects..."
          onChange={(event) => setQuery(String(event.value ?? ""))}
          theme={{ caret: theme.foreground }}
          style={{ flexGrow: 1, minWidth: 0, fontSize: 14, lineHeight: 20, fontFamily: FONTS.sans, color: theme.foreground }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: 320, overflowY: "scroll", padding: 4 }}>
        {candidates.length === 0 ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 24, paddingBottom: 24 }}>
            <Text color={theme.mutedForeground}>No active threads found.</Text>
          </div>
        ) : (
          candidates.map((thread) => {
            const linked = linking.isLinked(thread, url);
            const disabled = pending || linked;
            return (
              <div
                key={thread.id}
                testId={`pr-link-thread-${thread.id}`}
                onClick={disabled ? undefined : () => onSelect(thread.id)}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingLeft: 8,
                  paddingRight: 8,
                  paddingTop: 6,
                  paddingBottom: 6,
                  borderRadius: RADIUS.sm,
                  flexShrink: 0,
                  opacity: disabled ? 0.64 : 1,
                  cursor: disabled ? "default" : "pointer",
                  ...(disabled ? {} : { hover: { backgroundColor: theme.accent } }),
                }}
              >
                <Icon name="message-square" size={16} color={theme.mutedForeground} />
                <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                  <Text truncate>{thread.title || "Untitled thread"}</Text>
                  <Text size="xs" color={theme.mutedForeground} truncate>
                    {projectNames.get(thread.projectId) ?? ""}
                  </Text>
                </div>
                {linked ? (
                  <>
                    <Icon name="check" size={14} color={theme.foreground} />
                    <Text size="xs" color={theme.mutedForeground}>
                      Linked
                    </Text>
                  </>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
