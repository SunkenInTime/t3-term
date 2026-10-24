// Port of apps/web/src/components/chat/SubagentTooltipContent.tsx (inside web's
// ThreadHoverCard): the hover card on a subagent row. Title, model with effort and speed,
// status with elapsed time, the workspace when it differs from the parent's, and a
// preview of the latest progress or result.
//
// `SubagentHoverCard` is web's ThreadHoverCardPopup (a glass tooltip, max-w-80) around it.
import * as TooltipPrimitive from "@gpuix/react/tooltip";
import type { FloatingSide } from "@gpuix/react/floating";
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  ThreadId,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadShell,
  OrchestrationV2TurnItemStatus,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import {
  formatSubagentDisplayTitle,
  resolveSubagentMetadata,
  subagentDetailPreview,
} from "@t3tools/client-runtime/state/subagent-display";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { REASONING_EFFORT_OPTION_IDS } from "@t3tools/client-runtime/state/thread-execution";
import { getModelSelectionStringOptionValue, resolveSelectableModel } from "@t3tools/shared/model";
import type { ReactElement, ReactNode } from "react";

import { environmentProjects, environmentThreadShells, serverEnvironment } from "../../state/environment.ts";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import { deriveProviderInstanceEntries, shouldShowInstanceBadge } from "../../web/providerInstances.ts";
import { splitForMiddleTruncate } from "../../web/components/ui/middleTruncate.ts";
import { ProviderInstanceIcon } from "../composer/ProviderInstanceIcon.tsx";
import { getTraitsSpeedDisplay, TraitsSpeedIcon } from "../composer/TraitsSpeed.tsx";

export interface SubagentTooltipProps {
  readonly title: string;
  readonly model: string | null;
  readonly providerInstanceId: ProviderInstanceId;
  readonly origin: OrchestrationV2Subagent["origin"];
  readonly modelSelection?: OrchestrationV2Subagent["modelSelection"];
  readonly provider?: ServerProvider | undefined;
  readonly providers?: ReadonlyArray<ServerProvider> | undefined;
  readonly driver?: ProviderDriverKind | undefined;
  readonly elapsed?: ReactNode;
  readonly parentThread?: Pick<OrchestrationV2ThreadShell, "projectId" | "worktreePath"> | undefined;
  readonly childThread?: Pick<OrchestrationV2ThreadShell, "branch" | "worktreePath" | "modelSelection"> | undefined;
  readonly parentProject?: Pick<OrchestrationProjectShell, "workspaceRoot"> | undefined;
  readonly childProject?: Pick<OrchestrationProjectShell, "id" | "title" | "workspaceRoot"> | undefined;
  readonly status: OrchestrationV2TurnItemStatus;
  readonly result?: string | null | undefined;
  readonly progress?: string | null | undefined;
}

/** Geometry and preview limits stay identical in lineage and timeline tooltips. */
export function SubagentTooltipContent(props: SubagentTooltipProps) {
  const theme = useTheme();
  const { modelLabel, workspace: metadata } = resolveSubagentMetadata(props);
  const preview = subagentDetailPreview(props);
  const model = props.model?.trim();
  const modelSlug = props.provider ? resolveSelectableModel(props.provider.driver, model, props.provider.models) : model;
  const providerModel = props.provider?.models.find((candidate) => candidate.slug === modelSlug);
  const childSelection =
    props.modelSelection ?? (props.origin === "app_owned" ? props.childThread?.modelSelection : undefined);
  const childModel = props.provider
    ? (resolveSelectableModel(props.provider.driver, childSelection?.model, props.provider.models) ??
      childSelection?.model.trim())
    : childSelection?.model.trim();
  const provider = props.provider;
  const matchingSelection =
    childModel === (modelSlug ?? model) && childSelection?.instanceId === props.providerInstanceId
      ? childSelection
      : undefined;
  const effort = REASONING_EFFORT_OPTION_IDS.map((id) => getModelSelectionStringOptionValue(matchingSelection, id)).find(
    Boolean,
  );
  const speed = provider
    ? providerModel?.capabilities?.optionDescriptors
        ?.map((descriptor) => {
          const saved = matchingSelection?.options?.find((option) => option.id === descriptor.id);
          if (descriptor.id === "fastMode" && descriptor.type === "boolean" && typeof saved?.value === "boolean") {
            return getTraitsSpeedDisplay(provider.driver, { ...descriptor, currentValue: saved.value });
          }
          if (
            provider.driver === "codex" &&
            descriptor.id === "serviceTier" &&
            descriptor.type === "select" &&
            typeof saved?.value === "string" &&
            descriptor.options.some((option) => option.id === saved.value)
          ) {
            return getTraitsSpeedDisplay(provider.driver, { ...descriptor, currentValue: saved.value });
          }
          return null;
        })
        .find(Boolean)
    : undefined;
  const driver = props.provider?.driver ?? props.driver;
  const entries = deriveProviderInstanceEntries(props.providers ?? []);
  const entry = entries.find((candidate) => candidate.instanceId === props.provider?.instanceId);
  const showInstanceBadge = entry !== undefined && shouldShowInstanceBadge(entry, entries);
  const working = ["running", "in_progress", "pending", "waiting"].includes(props.status);
  const failed = ["failed", "error"].includes(props.status);
  const statusIcon: IconName = working
    ? "circle-dashed"
    : failed
      ? "circle-x"
      : props.status === "completed"
        ? "check"
        : "circle-dashed";
  const statusColor = working
    ? theme.info
    : failed
      ? theme.errorForeground
      : props.status === "completed"
        ? theme.success
        : theme.mutedForeground;
  const muted = theme.mutedForeground;
  const label = props.status.replaceAll("_", " ");
  return (
    // web ThreadHoverCard: px-1 py-2, gap-2; title text-xs font-medium; body grid gap-1.5 pl-0.5.
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, maxWidth: 304, paddingLeft: 4, paddingRight: 4, paddingTop: 8, paddingBottom: 8 }}>
      <SmallText color={theme.foreground} weight={500} truncate>
        {props.title}
      </SmallText>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 2 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
          {driver ? (
            <div style={{ opacity: 0.6 }}>
              <ProviderInstanceIcon
                driverKind={driver}
                displayName={entry?.displayName ?? props.provider?.displayName ?? driver}
                accentColor={entry?.accentColor}
                showBadge={showInstanceBadge && entry?.accentColor !== undefined}
                compactBadge
                monochrome
                color={muted}
                size={12}
              />
            </div>
          ) : (
            <Icon name="bot" size={12} color={muted} />
          )}
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
            <SmallText color={alpha(theme.foreground, 0.75)} truncate>
              {showInstanceBadge && entry ? `${modelLabel} · ${entry.displayName}` : modelLabel}
            </SmallText>
            {effort || speed?.speedIcon ? (
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
                {effort ? <SmallText color={alpha(theme.foreground, 0.75)}>·</SmallText> : null}
                {speed?.speedIcon && provider ? (
                  <TraitsSpeedIcon provider={provider.driver} speedIcon={speed.speedIcon} size="xs" color={alpha(theme.foreground, 0.75)} />
                ) : null}
                {effort ? <SmallText color={alpha(theme.foreground, 0.75)}>{effort}</SmallText> : null}
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name={statusIcon} size={12} color={statusColor} />
            <SmallText color={statusColor} weight={500}>
              {label.charAt(0).toUpperCase() + label.slice(1)}
            </SmallText>
          </div>
          {props.elapsed}
        </div>
        {metadata.map(({ label: metaLabel, value }) => (
          <div key={metaLabel} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Icon name={metaLabel === "Branch" ? "git-branch" : "folder"} size={12} color={muted} />
            <MiddleText value={value} color={muted} />
          </div>
        ))}
        {preview ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Icon name="terminal" size={12} color={muted} />
            <MiddleText value={preview} color={muted} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SmallText({
  children,
  color,
  weight,
  truncate,
}: {
  children: ReactNode;
  color: string;
  weight?: number;
  truncate?: boolean;
}) {
  return (
    <text
      style={{
        color,
        fontSize: 12,
        lineHeight: 16,
        fontFamily: FONTS.sans,
        ...(weight === undefined ? {} : { fontWeight: weight }),
        ...(truncate ? { whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 } : { flexShrink: 0 }),
      }}
    >
      {children}
    </text>
  );
}

/** web MiddleTruncate: the head ellipsizes, the tail (a file name or last segment) stays. */
function MiddleText({ value, color }: { value: string; color: string }) {
  const split = splitForMiddleTruncate(value);
  if (!split) {
    return (
      <SmallText color={color} truncate>
        {value}
      </SmallText>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "row", minWidth: 0 }}>
      <SmallText color={color} truncate>
        {split.head}
      </SmallText>
      <SmallText color={color}>{split.tail}</SmallText>
    </div>
  );
}

/** web ThreadHoverCardPopup: the glass tooltip variant, max-w-80, around a hover card. */
export function SubagentHoverCard({
  card,
  side = "top",
  children,
  rootStyle,
}: {
  card: ReactNode;
  side?: FloatingSide;
  children: ReactElement;
  rootStyle?: Record<string, unknown>;
}) {
  const theme = useTheme();
  return (
    <TooltipPrimitive.Root style={{ alignItems: "stretch", ...rootStyle }}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={6}
        style={{
          display: "flex",
          flexDirection: "column",
          maxWidth: 320,
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: alpha(theme.foreground, 0.1),
          backgroundColor: theme.appearance === "dark" ? "#141414" : "#ffffff",
          boxShadow: { offsetX: 0, offsetY: 16, blurRadius: 40, spreadRadius: -18, color: "#0000008c" },
          pointerEvents: "none",
        }}
      >
        {card}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Root>
  );
}

const NO_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null);
const NO_PROJECT_ATOM = Atom.make<OrchestrationProjectShell | null>(null);
const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];

/**
 * web V2LifecycleRow's SubagentTooltip: resolves the provider catalog, both threads and
 * their projects once per hovered row, then renders the card around `children`.
 */
export function SubagentRowHoverCard(props: {
  readonly environmentId: EnvironmentId;
  readonly parentThreadId: ThreadId | null;
  readonly childThreadId: ThreadId | null;
  readonly title: string;
  readonly model: string | null;
  readonly providerInstanceId: ProviderInstanceId;
  readonly origin: OrchestrationV2Subagent["origin"];
  readonly modelSelection?: OrchestrationV2Subagent["modelSelection"];
  readonly driver?: ProviderDriverKind;
  readonly elapsed?: ReactNode;
  readonly status: OrchestrationV2TurnItemStatus;
  readonly result?: string | null;
  readonly progress?: string | null;
  readonly children: ReactElement;
  readonly rootStyle?: Record<string, unknown>;
  readonly side?: FloatingSide;
}) {
  const { environmentId } = props;
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? NO_PROVIDERS;
  const parent = useAtomValue(
    props.parentThreadId ? environmentThreadShells.threadShellAtom({ environmentId, threadId: props.parentThreadId }) : NO_SHELL_ATOM,
  )?.source;
  const child = useAtomValue(
    props.childThreadId ? environmentThreadShells.threadShellAtom({ environmentId, threadId: props.childThreadId }) : NO_SHELL_ATOM,
  )?.source;
  const parentProject = useAtomValue(
    parent ? environmentProjects.projectAtom({ environmentId, projectId: parent.projectId }) : NO_PROJECT_ATOM,
  );
  const childProject = useAtomValue(
    child ? environmentProjects.projectAtom({ environmentId, projectId: child.projectId }) : NO_PROJECT_ATOM,
  );
  return (
    <SubagentHoverCard
      {...(props.rootStyle ? { rootStyle: props.rootStyle } : {})}
      {...(props.side ? { side: props.side } : {})}
      card={
        <SubagentTooltipContent
          title={formatSubagentDisplayTitle(child?.title ?? props.title)}
          model={props.model}
          providerInstanceId={props.providerInstanceId}
          origin={props.origin}
          modelSelection={props.modelSelection}
          provider={providers.find((provider) => provider.instanceId === props.providerInstanceId)}
          providers={providers}
          driver={props.driver}
          elapsed={props.elapsed}
          status={props.status}
          result={props.result}
          progress={props.progress}
          {...(parent ? { parentThread: parent } : {})}
          {...(child ? { childThread: child } : {})}
          {...(parentProject ? { parentProject } : {})}
          {...(childProject ? { childProject } : {})}
        />
      }
    >
      {props.children}
    </SubagentHoverCard>
  );
}
