// Port of apps/web/src/components/chat/ComposerUsageLimits.tsx: the /usage-limits panel,
// a composer notice whose body lists each account's limit windows and reset credits.
//
// The compact limit rows follow web usage/UsageLimits.tsx LimitWindows (compact): label and
// "% left", a bar, then pace and "resets in". The bar's pace mark (a gap cut where the
// window's elapsed share sits) is left out.
import type { EnvironmentId, ProviderConsumeResetCreditInput, ServerProviderResetCredits, ServerProviderUsageWindow, ServerProvider, UsageLimitsReport } from "@t3tools/contracts";
import { formatResetsIn, limitsNotice, paceOf, remainingPercent } from "@t3tools/shared/usageLimits";

import { providerClients } from "../../settings/providers/providerDriverMeta.ts";
import { RedactedText } from "../../settings/RedactedText.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { useTheme } from "../../ui/theme.ts";
import { openExternalUrl } from "../../usage/openExternal.ts";
import { barColor, PaceIcon, ResetCreditDialog, resetCreditsSummary, useResetCredit } from "../../usage/UsageLimits.tsx";
import { useBannerIconColumn } from "./ComposerBannerParts.tsx";
import type { ComposerBannerStackItem } from "./ComposerBannerStack.tsx";
import { BannerGlyph } from "./useSystemComposerBanners.tsx";

type Account = UsageLimitsReport["accounts"][number];

function accountLabel(account: Account): string {
  if (!account.instanceId) return account.label;
  const driver = providerClients.get(account.driver)?.label ?? String(account.driver);
  const instance =
    account.displayName?.trim() || (String(account.instanceId) !== String(account.driver) ? account.instanceId : "");
  return instance && instance.toLowerCase() !== driver.toLowerCase() ? `${driver} · ${instance}` : driver;
}

function AccountSummary({ account, color }: { readonly account: Account; readonly color?: string }) {
  const theme = useTheme();
  const label = accountLabel(account);
  const textColor = color ?? theme.mutedForeground;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", minWidth: 0, flexShrink: 1 }}>
      {label.includes("@") ? (
        <RedactedText value={label} revealTooltip="Click to reveal account" hideTooltip="Click to hide account" />
      ) : (
        <Text size="xs" color={textColor} truncate>
          {label}
        </Text>
      )}
      {account.plan ? (
        <Text size="xs" color={textColor} style={{ flexShrink: 0 }}>
          {` · ${account.plan}`}
        </Text>
      ) : null}
    </div>
  );
}

export function usageLimitsBannerItem(
  id: string,
  report: UsageLimitsReport,
  environmentId: EnvironmentId,
  onDismiss: () => void,
): ComposerBannerStackItem {
  const [first] = report.accounts;
  const single = report.accounts.length === 1 && first ? first : null;
  return {
    id,
    variant: "info",
    priority: "notice",
    icon: <BannerGlyph name="gauge" />,
    title: "Usage limits",
    description: single ? <AccountSummary account={single} /> : `${report.accounts.length} accounts`,
    dismissLabel: "Dismiss usage limits",
    onDismiss,
    children: <UsageLimitsBannerBody report={report} environmentId={environmentId} />,
  };
}

/** ComposerBanner.Scroll (max 24rem) around ComposerBanner.Body (ps-7: aligned with the title). */
function UsageLimitsBannerBody({ report, environmentId }: { readonly report: UsageLimitsReport; readonly environmentId: EnvironmentId }) {
  const theme = useTheme();
  const iconColumn = useBannerIconColumn();
  const now = Date.parse(report.createdAt);
  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: 384, overflowY: "scroll", minWidth: 0 }}>
      <div
        testId="usage-limits-body"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          // ComposerBanner.Body ps-8 sm:ps-7: aligned with the title.
          paddingLeft: iconColumn + 4,
          paddingTop: 4,
          paddingBottom: 6,
          paddingRight: 8,
          minWidth: 0,
        }}
      >
        {report.accounts.map((account) => {
          const resetCreditInput: ProviderConsumeResetCreditInput | undefined =
            account.resetCreditInput ?? (account.instanceId ? { instanceId: account.instanceId } : undefined);
          const notice = limitsNotice(account.limits);
          const externalUsage = account.limits.externalUsage;
          return (
            <div key={account.id} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              {report.accounts.length > 1 ? <AccountSummary account={account} /> : null}
              {notice ? (
                <Text size="xs" color={theme.mutedForeground}>
                  {notice}
                </Text>
              ) : (
                <CompactLimitWindows driver={account.driver} windows={account.limits.windows} now={now} />
              )}
              {externalUsage ? (
                <div style={{ display: "flex", flexDirection: "row" }}>
                  <Button size="sm" variant="ghost" onClick={() => openExternalUrl(externalUsage.url)}>
                    Manage usage
                  </Button>
                </div>
              ) : null}
              {resetCreditInput && account.limits.resetCredits ? (
                <ResetCredits environmentId={environmentId} input={resetCreditInput} credits={account.limits.resetCredits} now={now} />
              ) : null}
            </div>
          );
        })}
        {report.notices.map((notice) => (
          <Text key={notice} size="xs" color={theme.mutedForeground}>
            {notice}
          </Text>
        ))}
      </div>
    </div>
  );
}

/** web LimitWindows compact: grid [≤9rem label + % left][bar][pace · resets in]. */
function CompactLimitWindows({
  driver,
  windows,
  now,
}: {
  readonly driver: ServerProvider["driver"];
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly now: number;
}) {
  const theme = useTheme();
  const color = barColor(driver, theme);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      {windows.map((window) => {
        const pace = paceOf(window, now);
        const resetsIn = formatResetsIn(window, now);
        const remaining = remainingPercent(window);
        return (
          <div key={window.id} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, width: 144, flexShrink: 1, minWidth: 0 }}>
              <Text size="xs" color={theme.mutedForeground} truncate>
                {window.label}
              </Text>
              <div style={{ flexGrow: 1 }} />
              <Text size="xs" weight={500} style={{ flexShrink: 0 }}>
                {`${remaining}% left`}
              </Text>
            </div>
            {/* inset-y-1.5 track with the remaining share filled from the left. */}
            <div style={{ display: "flex", flexDirection: "row", height: 12, marginTop: 6, marginBottom: 6, flexGrow: 1, flexBasis: 0, minWidth: 48, borderRadius: 6, overflow: "hidden", backgroundColor: theme.muted }}>
              {remaining > 0 ? <div style={{ flexGrow: remaining, flexBasis: 0, backgroundColor: color, borderRadius: 6 }} /> : null}
              {remaining < 100 ? <div style={{ flexGrow: 100 - remaining, flexBasis: 0 }} /> : null}
            </div>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {pace ? <PaceIcon pace={pace} /> : null}
              <Text size="xs" color={theme.mutedForeground}>
                {resetsIn ?? ""}
              </Text>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** web usage/UsageLimits.tsx ResetCredits: the summary, "Use reset" behind a confirm, and the outcome. */
function ResetCredits({
  environmentId,
  input,
  credits,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly input: ProviderConsumeResetCreditInput;
  readonly credits: ServerProviderResetCredits;
  readonly now: number;
}) {
  const theme = useTheme();
  const { canManageProviders, confirming, setConfirming, busy, status, redeem } = useResetCredit(environmentId, input);
  if (credits.availableCount === 0 && status === null) return null;
  return (
    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 4 }}>
      <Text size="xs" color={theme.mutedForeground}>
        {resetCreditsSummary(credits, now)}
      </Text>
      {credits.availableCount > 0 ? (
        <Button size="xs" variant="outline" disabled={busy || !canManageProviders} onClick={() => setConfirming(true)}>
          {busy ? "Using…" : "Use reset"}
        </Button>
      ) : null}
      {status ? <Text size="xs">{status}</Text> : null}
      <ResetCreditDialog open={confirming} onOpenChange={setConfirming} onConfirm={() => void redeem()} disabled={!canManageProviders} />
    </div>
  );
}
