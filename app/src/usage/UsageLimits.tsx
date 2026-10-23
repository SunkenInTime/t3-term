// Port of apps/web/src/components/usage/UsageLimits.tsx (the parts the Usage page
// renders) and apps/web/src/components/usage/UsageLimitsPooled.tsx.
//
// gpuix has no clip-path or CSS gradients: the pace gap is a page-background slot
// painted over the bar, and the refill hatch is a generated SVG pattern drawn by <img>.
import { useAtomValue } from "@effect/atom-react";
import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type ProviderConsumeResetCreditOutcome,
  type ProviderConsumeResetCreditInput,
  type ServerProvider,
  type ServerProviderResetCredits,
  type UsageProviderKind,
} from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  CHATGPT_USAGE_URL,
  collectExternalUsageLinks,
  collectLimitAccounts,
  collectLimitNotices,
  collectLimitPools,
  cursorUsageWindowDetails,
  displayLimitWindows,
  formatDuration,
  formatResetsIn,
  paceRemainingPercent,
  remainingPercent,
  type LimitAccount,
  type LimitPace,
  type LimitPool,
  type LimitPoolMember,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { serverEnvironment } from "../state/environment.ts";
import {
  environmentPresentations,
  readEnvironmentScope,
  useEnvironmentScope,
  useUsageOverlay,
} from "../state/usage.ts";
import { PROVIDER_PRESENTATION } from "../web/components/usage/usageProviders.ts";
import { redactedPlaceholder } from "../web/components/usage/redactedPlaceholder.ts";
import { formatUpcomingTimestamp } from "../web/components/usage/usageTimestamp.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Button, Text } from "../ui/primitives.tsx";
import { Dialog, Popover, Tooltip } from "../ui/overlay.tsx";
import { FONTS, RADIUS, alpha, useTheme, type Palette } from "../ui/theme.ts";
import { openExternalUrl } from "./openExternal.ts";
import { ProviderGlyph } from "./ProviderMark.tsx";
import { UsageScrollContext } from "./UsageProviderChart.tsx";
import { resolveUsageColor } from "./usageUi.tsx";

const PROVIDER_LABELS: Record<string, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  pi: "Pi",
};

/** web `providerClients.get(driver)?.label`. */
function driverLabel(driver: ServerProvider["driver"]): string {
  return PROVIDER_LABELS[driver] ?? String(driver);
}

const PACE: Record<LimitPace, { readonly label: string; readonly icon: IconName }> = {
  ahead: { label: "Ahead of pace: spending faster than the window elapses", icon: "trending-up" },
  on: { label: "On pace with the window", icon: "gauge" },
  under: { label: "Under pace: headroom left for the rest of the window", icon: "trending-down" },
};

export function barColor(driver: ServerProvider["driver"], theme: Palette): string {
  const presentation = Object.values(PROVIDER_PRESENTATION).find((entry) => entry.driverKind === driver);
  return presentation ? resolveUsageColor(presentation.color, theme) : theme.foreground;
}

export function PaceIcon({ pace }: { readonly pace: LimitPace }) {
  const theme = useTheme();
  return (
    <Tooltip side="top" content={PACE[pace].label}>
      <div style={{ display: "flex" }}>
        <Icon name={PACE[pace].icon} size={14} color={theme.mutedForeground} />
      </div>
    </Tooltip>
  );
}

const OUTCOME_TEXT: Record<ProviderConsumeResetCreditOutcome, string> = {
  reset: "Reset applied. Your windows have cleared.",
  nothingToReset: "Nothing to reset right now.",
  noCredit: "No reset credit left.",
  alreadyRedeemed: "That credit was already redeemed.",
};

export function useResetCredit(environmentId: EnvironmentId, input: ProviderConsumeResetCreditInput) {
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const redeem = async () => {
    setConfirming(false);
    if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    setBusy(true);
    setStatus(null);
    const result = await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.consumeResetCredit,
      { environmentId, input },
      { reportFailure: false },
    );
    setBusy(false);
    if (result._tag === "Success") {
      setStatus(result.value.warning ?? OUTCOME_TEXT[result.value.outcome]);
      return;
    }
    const cause = result.cause as unknown as { error?: unknown };
    setStatus(cause.error instanceof Error ? cause.error.message : "Could not use the reset credit.");
  };

  return { canManageProviders, confirming, setConfirming, busy, status, redeem };
}

/** Redeeming spends a credit the provider granted the user, so it never fires on a bare click. */
export function ResetCreditDialog({
  open,
  onOpenChange,
  onConfirm,
  disabled = false,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly disabled?: boolean;
}) {
  useUsageOverlay(open);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Use a reset credit?"
      description="This redeems one credit on your account and clears the current rate-limit windows. It cannot be undone."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} testId="usage-reset-cancel">
            Cancel
          </Button>
          <Button disabled={disabled} onClick={onConfirm} testId="usage-reset-confirm">
            Use credit
          </Button>
        </>
      }
    />
  );
}

export function resetCreditsSummary(credits: ServerProviderResetCredits, now: number, compact = false): string {
  const expiresIn = credits.nextExpiresAt ? formatDuration(Date.parse(credits.nextExpiresAt) - now) : null;
  if (credits.availableCount === 0) return "No reset credits banked";
  if (compact) return `${credits.availableCount} banked${expiresIn ? ` · expires in ${expiresIn}` : ""}`;
  return `${credits.availableCount} ${credits.availableCount === 1 ? "reset credit" : "reset credits"} banked${
    expiresIn ? ` · next expires in ${expiresIn}` : ""
  }`;
}

/**
 * The page advances `now` on explicit refresh rather than ticking: a live clock would repaint the
 * page for no decision-changing gain.
 */
export function UsageLimitsSection({
  selectedEnvironmentIds,
  hiddenProviders,
  now,
  cursorPrompt,
}: {
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly now: number;
  readonly cursorPrompt?: ReactNode;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const hiddenDrivers = new Set<ServerProvider["driver"]>(
    [...hiddenProviders].map((provider) => PROVIDER_PRESENTATION[provider].driverKind),
  );
  const isVisible = (driver: ServerProvider["driver"]) => !hiddenDrivers.has(driver);
  const selected = new Map(
    [...presentations].flatMap(([id, presentation]) => {
      if (selectedEnvironmentIds !== null && !selectedEnvironmentIds.has(id)) return [];
      const config = presentation.serverConfig;
      if (hiddenDrivers.size === 0 || config === null) return [[id, presentation] as const];
      return [
        [
          id,
          {
            ...presentation,
            serverConfig: {
              ...config,
              providers: config.providers.filter((provider) => isVisible(provider.driver)),
              usageLimitSources: config.usageLimitSources?.flatMap((source) => {
                const accounts = source.accounts.filter((account) => isVisible(account.driver));
                return accounts.length === 0 && source.accounts.length > 0 ? [] : [{ ...source, accounts }];
              }),
            },
          },
        ] as const,
      ];
    }),
  );
  return <UsageLimitsPooled presentations={selected} now={now} cursorPrompt={cursorPrompt} />;
}

// ── Pooled view (UsageLimitsPooled.tsx) ─────────────────────────────────

function accountInitials(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local[0] ?? ""}${domain[0] ?? ""}`.toUpperCase() || "?";
}

function accountHue(email: string): number {
  let hash = 0;
  for (let index = 0; index < email.length; index += 1) {
    hash = (hash * 31 + email.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

/** oklch(l c h) to #rrggbb; the account chip's colors are written in oklch on web. */
function oklch(l: number, c: number, hue: number): string {
  const h = (hue * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return `#${linear
    .map((value) => {
      const clamped = Math.max(0, Math.min(1, value));
      const srgb = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return Math.round(srgb * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

function AccountChip({ email }: { readonly email: string }) {
  const hue = accountHue(email);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        borderRadius: 8,
        flexShrink: 0,
        backgroundColor: oklch(0.85, 0.08, hue),
      }}
    >
      <text style={{ color: oklch(0.35, 0.1, hue), fontSize: 8, lineHeight: 8, fontWeight: 600, fontFamily: FONTS.sans }}>
        {accountInitials(email)}
      </text>
    </div>
  );
}

function AccountAvatar({ account }: { readonly account: LimitAccount }) {
  if (account.redeem) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, flexShrink: 0 }}>
        <ProviderGlyph
          driver={account.driver}
          displayName={account.displayName ?? driverLabel(account.driver)}
          size={16}
          opacity={0.8}
        />
      </div>
    );
  }
  return account.email ? <AccountChip email={account.email} /> : null;
}

function AccountName({ account, color, weight }: { readonly account: LimitAccount; readonly color?: string; readonly weight?: number }) {
  const theme = useTheme();
  if (account.displayName)
    return (
      <Text size="xs" weight={weight} color={color ?? theme.foreground} truncate>
        {account.displayName}
      </Text>
    );
  if (account.email) return <AccountChip email={account.email} />;
  return (
    <Text size="xs" weight={weight} color={color ?? theme.foreground} truncate>
      {driverLabel(account.driver)}
    </Text>
  );
}

function DetailRow({ label, children }: { readonly label: string; readonly children: string }) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
      <div style={{ width: 72, flexShrink: 0 }}>
        <Text size="xs" color={theme.mutedForeground}>
          {label}
        </Text>
      </div>
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <Text size="xs">{children}</Text>
      </div>
    </div>
  );
}

function RedactedEmail({ value }: { readonly value: string }) {
  const theme = useTheme();
  const [revealed, setRevealed] = useState(false);
  return (
    <Tooltip side="top" content={revealed ? "Click to hide email" : "Click to reveal email"}>
      <div
        testId="usage-account-email"
        onClick={() => setRevealed((current) => !current)}
        style={{ display: "flex", alignSelf: "flex-start", cursor: "pointer", borderRadius: 4 }}
      >
        {/* No blur in gpuix: the scrambled placeholder is dimmed instead. */}
        <text
          style={{
            color: theme.mutedForeground,
            fontSize: 11,
            lineHeight: 16,
            fontFamily: FONTS.mono,
            opacity: revealed ? 1 : 0.45,
          }}
        >
          {revealed ? value : redactedPlaceholder(value)}
        </text>
      </div>
    </Tooltip>
  );
}

type RedeemState = ReturnType<typeof useResetCredit>;

function SegmentPopoverContent({
  account,
  window,
  reset,
  now,
  redeem,
  onRedeem,
}: {
  readonly account: LimitAccount;
  readonly window: LimitPoolMember["window"];
  readonly reset: LimitPoolWindow["resets"][number] | undefined;
  readonly now: number;
  readonly redeem: RedeemState | null;
  readonly onRedeem: () => void;
}) {
  const theme = useTheme();
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const resetsIn = formatResetsIn(window, now);
  const where =
    account.environments.length > 0
      ? account.environments.map((environment) => environment.label).join(", ")
      : account.sourceLabel;
  const credits = redeem && account.limits.resetCredits?.availableCount ? account.limits.resetCredits : null;
  const section = {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderColor: alpha(theme.border, 0.6),
  } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: 288 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <AccountAvatar account={account} />
          <Text weight={500} truncate>
            {account.displayName ?? driverLabel(account.driver)}
          </Text>
        </div>
        {account.email ? <RedactedEmail value={account.email} /> : null}
      </div>
      {account.plan || where ? (
        <div style={section}>
          {account.plan ? <DetailRow label="Plan">{account.plan}</DetailRow> : null}
          {where ? <DetailRow label={account.environments.length > 0 ? "Signed in" : "Via"}>{where}</DetailRow> : null}
        </div>
      ) : null}
      <div style={section}>
        <DetailRow label="Left">{`${remaining}%`}</DetailRow>
        {window.resetsAt ? (
          <DetailRow label="Resets">
            {`${formatUpcomingTimestamp(window.resetsAt, "locale", now)}${resetsIn ? ` · ${resetsIn.replace("resets in ", "in ")}` : ""}`}
          </DetailRow>
        ) : null}
        {timeLeft !== null ? <DetailRow label="Even pace">{`${timeLeft}% left by now`}</DetailRow> : null}
        {reset && reset.restoresPercent > 0 ? <DetailRow label="Restores">{`+${reset.restoresPercent}% of pool`}</DetailRow> : null}
      </div>
      {credits && redeem ? (
        <div style={{ ...section, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text size="xs" color={theme.mutedForeground}>
            {resetCreditsSummary(credits, now, true)}
          </Text>
          <div style={{ flexGrow: 1 }} />
          <Button
            size="xs"
            variant="outline"
            testId="usage-use-reset"
            disabled={redeem.busy || !redeem.canManageProviders}
            onClick={onRedeem}
          >
            {redeem.busy ? "Using…" : "Use reset"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every segment on the page shares one popover slot, so hovering another segment
 * moves it instead of opening a second one.
 */
interface SegmentPopoverControl {
  readonly active: string | null;
  readonly open: (key: string) => void;
  /** Opens and keeps it open when the pointer leaves, like a click on a hover trigger. */
  readonly pin: (key: string) => void;
  readonly setHovered: (key: string | null) => void;
  /** An outside press on the hovered trigger is the click that pins it, not a dismissal. */
  readonly dismiss: (key: string) => void;
  readonly close: () => void;
  readonly scheduleClose: () => void;
  readonly cancelClose: () => void;
}

const SegmentPopoverContext = createContext<SegmentPopoverControl | null>(null);

function useSegmentPopoverControl(): SegmentPopoverControl {
  const [active, setActive] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const hovered = useRef<string | null>(null);
  const cancelClose = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelClose, []);
  return {
    active,
    open: (key) => {
      cancelClose();
      setActive((current) => {
        if (current !== key) pinned.current = false;
        return key;
      });
    },
    setHovered: (key) => {
      hovered.current = key;
    },
    dismiss: (key) => {
      if (hovered.current === key) return;
      cancelClose();
      pinned.current = false;
      setActive(null);
    },
    pin: (key) => {
      cancelClose();
      pinned.current = true;
      setActive(key);
    },
    close: () => {
      cancelClose();
      pinned.current = false;
      setActive(null);
    },
    // Leaving the segment toward its popover must not close it on the way.
    scheduleClose: () => {
      cancelClose();
      if (pinned.current) return;
      timer.current = setTimeout(() => setActive(null), 200);
    },
    cancelClose,
  };
}

/** Popover surface width: 288 content + 2 × 16 padding + 2 × 1 border. */
const POPOVER_WIDTH = 322;
const POPOVER_HEIGHT_ESTIMATE = 280;

const HATCH_CACHE = new Map<string, string>();

/** `repeating-linear-gradient(135deg, color 0 1px, transparent 1px 5px)` as an SVG tile. */
function hatchImage(color: string, width: number, height: number): string {
  const key = `${color}:${width}:${height}`;
  let image = HATCH_CACHE.get(key);
  if (image === undefined) {
    const lines: string[] = [];
    // 135deg stripes run from bottom-left to top-right; spacing 5px along the normal.
    const step = 5 * Math.SQRT2;
    for (let offset = -height; offset < width + height; offset += step) {
      lines.push(`<line x1="${offset.toFixed(2)}" y1="${height}" x2="${(offset + height).toFixed(2)}" y2="0"/>`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g stroke="${color}" stroke-width="1">${lines.join("")}</g></svg>`;
    image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    HATCH_CACHE.set(key, image);
  }
  return image;
}

function PoolSegment({
  account,
  ...props
}: {
  readonly account: LimitAccount;
  readonly window: LimitPoolMember["window"];
  readonly reset: LimitPoolWindow["resets"][number] | undefined;
  readonly refillPercent: number;
  readonly color: string;
  readonly now: number;
  readonly index: number;
  readonly showAccountName: boolean;
  readonly wide: boolean;
  readonly width: number;
  readonly segmentKey: string;
}) {
  return account.redeem ? (
    <RedeemableSegment account={account} redeemAt={account.redeem} {...props} />
  ) : (
    <SegmentTrigger account={account} redeem={null} {...props} />
  );
}

function RedeemableSegment({
  redeemAt,
  ...props
}: Omit<Parameters<typeof SegmentTrigger>[0], "redeem"> & {
  readonly redeemAt: NonNullable<LimitAccount["redeem"]>;
}) {
  const theme = useTheme();
  const redeem = useResetCredit(redeemAt.environmentId, redeemAt.input);
  return (
    <>
      <SegmentTrigger redeem={redeem} {...props} />
      <ResetCreditDialog
        open={redeem.confirming}
        onOpenChange={redeem.setConfirming}
        onConfirm={() => void redeem.redeem()}
        disabled={!redeem.canManageProviders}
      />
      {/* The popover closed before the confirm, so progress and the outcome need a home outside it. */}
      {redeem.busy || redeem.status ? (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
          <AccountName account={props.account} weight={500} />
          <Text size="xs" color={theme.mutedForeground}>
            {redeem.busy ? "Using reset credit…" : (redeem.status ?? "")}
          </Text>
        </div>
      ) : null}
    </>
  );
}

function SegmentTrigger({
  account,
  window,
  reset,
  redeem,
  refillPercent,
  color,
  now,
  index,
  showAccountName,
  wide,
  width,
  segmentKey,
}: {
  readonly account: LimitAccount;
  readonly window: LimitPoolMember["window"];
  readonly reset: LimitPoolWindow["resets"][number] | undefined;
  readonly redeem: RedeemState | null;
  readonly refillPercent: number;
  readonly color: string;
  readonly now: number;
  readonly index: number;
  readonly showAccountName: boolean;
  readonly wide: boolean;
  readonly width: number;
  readonly segmentKey: string;
}) {
  const theme = useTheme();
  const control = useContext(SegmentPopoverContext);
  const scroll = useContext(UsageScrollContext);
  const [layoutY, setLayoutY] = useState<{ y: number; scroll: number } | null>(null);
  const open = control?.active === segmentKey;
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const resetsIn = formatResetsIn(window, now);
  const credits = account.limits.resetCredits?.availableCount ?? 0;
  const height = wide ? 32 : 20;
  // Base UI flips the popover below the bar when it does not fit above;
  // gpuix only shifts it into the window, so pick the side here.
  const windowY = layoutY === null ? Number.POSITIVE_INFINITY : layoutY.y + (scroll.current - layoutY.scroll);
  const side = windowY - POPOVER_HEIGHT_ESTIMATE - 6 < 8 ? "bottom" : "top";
  // Below 6px there is no room for the gap and tick (usePaceMark).
  const roomy = width >= 6;
  const tickAt = timeLeft === null || !roomy ? null : Math.min(width - 3, Math.max(3, (timeLeft / 100) * width));
  const hatchWidth =
    remaining < 100 && reset && refillPercent > 0 ? Math.round((Math.min(100 - remaining, refillPercent) / 100) * width) : 0;

  const trigger = (
    <div
      testId={`usage-limit-segment-${segmentKey}`}
      onLayout={(event) => setLayoutY({ y: event.y ?? 0, scroll: scroll.current })}
      // A click pins the hover popover open, as Base UI's openOnHover trigger does.
      onClick={() => control?.pin(segmentKey)}
      onMouseEnter={() => {
        control?.setHovered(segmentKey);
        control?.open(segmentKey);
      }}
      onMouseLeave={() => {
        control?.setHovered(null);
        control?.scheduleClose();
      }}
      style={{
        position: "relative",
        flexGrow: 1,
        height,
        minWidth: 0,
        borderRadius: RADIUS.md,
        backgroundColor: theme.muted,
        cursor: "pointer",
        overflow: "hidden",
        ...(open ? { outlineWidth: 1, outlineColor: theme.border, outlineOffset: -1 } : {}),
      }}
    >
      {remaining > 0 ? (
        <div
          style={{
            position: "absolute",
            pointerEvents: "none",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${remaining}%`,
            borderRadius: RADIUS.md,
            backgroundColor: color,
            opacity: 0.35,
          }}
        />
      ) : null}
      {hatchWidth > 0 && height > 0 ? (
        <img
          src={hatchImage(color, hatchWidth, height)}
          style={{
            position: "absolute",
            pointerEvents: "none",
            right: 0,
            top: 0,
            width: hatchWidth,
            height,
            opacity: 0.2,
            borderTopRightRadius: RADIUS.md,
            borderBottomRightRadius: RADIUS.md,
          }}
        />
      ) : null}
      {tickAt !== null ? (
        <>
          <div
            style={{ position: "absolute", left: tickAt - 3, top: 0, bottom: 0, width: 6, backgroundColor: theme.background, pointerEvents: "none" }}
          />
          <div
            style={{
              position: "absolute",
              left: tickAt - 1,
              top: 2,
              bottom: 2,
              width: 2,
              borderRadius: 1,
              backgroundColor: theme.foreground,
              pointerEvents: "none",
            }}
          />
        </>
      ) : null}
      {wide ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingLeft: 8,
            paddingRight: 8,
            pointerEvents: "none",
          }}
        >
          {showAccountName ? (
            <div style={{ minWidth: 0, flexShrink: 1 }}>
              <AccountName account={account} weight={500} />
            </div>
          ) : null}
          <div style={{ flexShrink: 0 }}>
            <Text size="xs" weight={600}>
              {`${remaining}%`}
            </Text>
          </div>
          <div style={{ flexGrow: 1 }} />
          {resetsIn || credits ? (
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingLeft: 6,
                paddingRight: 6,
                paddingTop: 2,
                paddingBottom: 2,
                borderRadius: 4,
                backgroundColor: alpha(theme.background, 0.85),
                minWidth: 0,
              }}
            >
              {resetsIn ? (
                <Text size="2xs" style={{ whiteSpace: "nowrap" }}>
                  {resetsIn.replace("resets in ", "↻ ")}
                </Text>
              ) : null}
              {credits ? (
                <>
                  {resetsIn ? (
                    <div>
                      <Text size="2xs" color={theme.mutedForeground}>
                        ·
                      </Text>
                    </div>
                  ) : null}
                  <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2 }}>
                    <Icon name="ticket" size={12} color={theme.foreground} />
                    <Text size="2xs" weight={600}>
                      {String(credits)}
                    </Text>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <Text size="3xs" weight={600} color={alpha(theme.foreground, 0.8)}>
            {String(index)}
          </Text>
        </div>
      )}
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? control?.open(segmentKey) : control?.dismiss(segmentKey))}
      side={side}
      align="start"
      alignOffset={(width - POPOVER_WIDTH) / 2}
      sideOffset={6}
      testId={`usage-limit-popover-${segmentKey}`}
      rootStyle={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}
      style={{ padding: 16 }}
      trigger={trigger}
    >
      <div onMouseEnter={() => control?.cancelClose()} onMouseLeave={() => control?.scheduleClose()}>
        <SegmentPopoverContent
          account={account}
          window={window}
          reset={reset}
          now={now}
          redeem={redeem}
          onRedeem={() => {
            control?.close();
            redeem?.setConfirming(true);
          }}
        />
      </div>
    </Popover>
  );
}

function LegendRow({
  account,
  window,
  color,
  now,
  index,
  segmentKey,
}: {
  readonly account: LimitAccount;
  readonly window: LimitPoolMember["window"];
  readonly color: string;
  readonly now: number;
  readonly index: number;
  readonly segmentKey: string;
}) {
  const theme = useTheme();
  const control = useContext(SegmentPopoverContext);
  const remaining = remainingPercent(window);
  const resetsIn = formatResetsIn(window, now);
  const credits = account.limits.resetCredits?.availableCount ?? 0;
  return (
    <div
      onClick={() => control?.pin(segmentKey)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 28,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: RADIUS.md,
        cursor: "pointer",
        minWidth: 0,
        hover: { backgroundColor: theme.accent },
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: 4, flexShrink: 0, backgroundColor: alpha(color, 0.35) }}>
        <Text size="3xs" weight={600} color={alpha(theme.foreground, 0.8)}>
          {String(index)}
        </Text>
      </div>
      <div style={{ minWidth: 0, flexShrink: 1 }}>
        <AccountName account={account} weight={500} />
      </div>
      <div style={{ flexShrink: 0 }}>
        <Text size="xs" weight={600}>
          {`${remaining}%`}
        </Text>
      </div>
      <div style={{ flexGrow: 1 }} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {resetsIn ? (
          <Text size="2xs" color={theme.mutedForeground}>
            {resetsIn.replace("resets in ", "↻ ")}
          </Text>
        ) : null}
        {credits ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Icon name="ticket" size={12} color={theme.foreground} />
            <Text size="2xs" weight={600}>
              {String(credits)}
            </Text>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PoolBar({ pool, color, now, poolKey }: { readonly pool: LimitPoolWindow; readonly color: string; readonly now: number; readonly poolKey: string }) {
  const [width, setWidth] = useState(0);
  const restores = new Map(pool.resets.map((reset) => [reset.member.account.key, reset]));
  // web switches layouts with an @2xl container query (672px) on the bar.
  const wide = width >= 672;
  const columns = pool.columns.length;
  const segmentWidth = columns === 0 ? 0 : (width - 4 * (columns - 1)) / columns;
  return (
    <div
      onLayout={(event) => setWidth(event.width ?? 0)}
      style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flexGrow: 1, flexBasis: 0 }}
    >
      <div style={{ display: "flex", flexDirection: "row", gap: 4 }}>
        {pool.columns.map((member, position) =>
          member.window ? (
            <PoolSegment
              key={member.account.key}
              segmentKey={`${poolKey}:${member.account.key}`}
              account={member.account}
              window={member.window}
              reset={restores.get(member.account.key)}
              refillPercent={member.refillPercent}
              color={color}
              now={now}
              index={position + 1}
              showAccountName={columns > 1}
              wide={wide}
              width={segmentWidth}
            />
          ) : (
            <div key={member.account.key} style={{ flexGrow: 1, flexBasis: 0 }} />
          ),
        )}
      </div>
      {wide
        ? null
        : pool.columns.map((member, position) =>
            member.window ? (
              <LegendRow
                key={member.account.key}
                segmentKey={`${poolKey}:${member.account.key}`}
                account={member.account}
                window={member.window}
                color={color}
                now={now}
                index={position + 1}
              />
            ) : null,
          )}
    </div>
  );
}

function PoolWindowCard({
  pool,
  color,
  now,
  label,
  description,
  poolKey,
  twoColumns,
}: {
  readonly pool: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
  readonly label?: string | undefined;
  readonly description?: string | undefined;
  readonly poolKey: string;
  readonly twoColumns: boolean;
}) {
  const theme = useTheme();
  const nextRefill = pool.resets.find((reset) => reset.restoresPercent > 0);
  return (
    <div
      testId={`usage-limit-card-${poolKey}`}
      style={{
        display: "flex",
        flexDirection: "column",
        rowGap: 12,
        padding: 16,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.6),
      }}
    >
      <div style={{ display: "flex", flexDirection: twoColumns ? "row" : "column", alignItems: twoColumns ? "center" : "stretch", columnGap: 24, rowGap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, ...(twoColumns ? { width: 176, flexShrink: 0 } : {}) }}>
          <Text weight={500}>{label ?? pool.label}</Text>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <Text size="3xl" weight={600}>
              {`${pool.remainingPercent}%`}
            </Text>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text color={theme.mutedForeground}>left</Text>
              {pool.pace ? <PaceIcon pace={pool.pace} /> : null}
            </div>
          </div>
          {nextRefill && pool.columns.length > 1 ? (
            <Text size="xs" weight={500}>
              {`↻ +${nextRefill.restoresPercent}%`}
            </Text>
          ) : null}
        </div>
        <PoolBar pool={pool} color={color} now={now} poolKey={poolKey} />
      </div>
      {description ? (
        <Text size="xs" color={theme.mutedForeground}>
          {description}
        </Text>
      ) : null}
    </div>
  );
}

function PoolSection({ pool, now, twoColumns }: { readonly pool: LimitPool; readonly now: number; readonly twoColumns: boolean }) {
  const theme = useTheme();
  const color = barColor(pool.driver, theme);
  const label = driverLabel(pool.driver);
  const windows = displayLimitWindows(pool);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20 }}>
          <ProviderGlyph driver={pool.driver} displayName={label} size={16} opacity={0.8} />
        </div>
        <Text weight={500}>{label}</Text>
      </div>
      {windows.map((window) => {
        const details = pool.driver === "cursor" ? cursorUsageWindowDetails(window.id) : undefined;
        const poolKey = `${pool.driver}:${window.kind}:${window.id}`;
        return (
          <PoolWindowCard
            key={poolKey}
            poolKey={poolKey}
            pool={window}
            color={color}
            now={now}
            label={details?.label}
            description={details?.description}
            twoColumns={twoColumns}
          />
        );
      })}
    </div>
  );
}

export function UsageLimitsPooled({
  presentations,
  now,
  cursorPrompt,
}: {
  readonly presentations: Parameters<typeof collectLimitAccounts>[0];
  readonly now: number;
  readonly cursorPrompt?: ReactNode;
}) {
  const theme = useTheme();
  const control = useSegmentPopoverControl();
  const [width, setWidth] = useState(0);
  const pools = collectLimitPools(collectLimitAccounts(presentations), now);
  const notices = collectLimitNotices(presentations);
  const externalLinks = collectExternalUsageLinks(presentations);
  const cursorPromptAt =
    Math.max(
      pools.findIndex((pool) => pool.driver === "codex"),
      pools.findIndex((pool) => pool.driver === "claudeAgent"),
    ) + 1;
  // web's md:grid-cols card layout, measured on the page container (viewport ≥ 768).
  const twoColumns = width === 0 || width >= 720;
  return (
    <div onLayout={(event) => setWidth(event.width ?? 0)} style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {pools.length === 0 && notices.length === 0 && !cursorPrompt && externalLinks.length === 0 ? (
        <Text color={theme.mutedForeground}>No provider on the selected environments reports subscription limits.</Text>
      ) : null}
      <SegmentPopoverContext.Provider value={control}>
        {pools.map((pool, index) => (
          <Fragment key={pool.driver}>
            {index === cursorPromptAt ? cursorPrompt : null}
            <PoolSection pool={pool} now={now} twoColumns={twoColumns} />
          </Fragment>
        ))}
      </SegmentPopoverContext.Provider>
      {cursorPromptAt === pools.length ? cursorPrompt : null}
      {externalLinks.map((link) => (
        <div
          key={link.url}
          style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: 16,
            borderRadius: RADIUS.xl,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
            {link.url === CHATGPT_USAGE_URL ? <ProviderGlyph driver="codex" displayName="OpenAI" size={20} /> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <Text weight={500}>{link.label}</Text>
              {link.url === CHATGPT_USAGE_URL ? (
                <Text size="xs" color={theme.mutedForeground}>
                  View usage in ChatGPT with your connected account.
                </Text>
              ) : link.message ? (
                <Text size="xs" color={theme.mutedForeground} style={{ maxWidth: 576 }}>
                  {link.message}
                </Text>
              ) : null}
            </div>
          </div>
          <Button variant="ghost-muted" size="xs" trailingIcon="external-link" onClick={() => openExternalUrl(link.url)}>
            Manage usage
          </Button>
        </div>
      ))}
      <LimitNotices notices={notices} />
    </div>
  );
}

/** ui/alert.tsx variant="warning". */
function LimitNotices({ notices }: { readonly notices: readonly string[] }) {
  const theme = useTheme();
  if (notices.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 8,
        paddingTop: 12,
        paddingBottom: 12,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: alpha(theme.warning, 0.32),
        backgroundColor: alpha(theme.warning, 0.04),
      }}
    >
      <div style={{ paddingTop: 2 }}>
        <Icon name="triangle-alert" size={16} color={theme.warningForeground} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
        {notices.map((notice) => (
          <Text key={notice} weight={500}>
            {notice}
          </Text>
        ))}
      </div>
    </div>
  );
}
