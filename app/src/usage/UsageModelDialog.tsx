// Port of apps/web/src/components/usage/UsageModelDialog.tsx and the
// UsageModelDialogHost from UsagePage.tsx.
import { useAtomValue } from "@effect/atom-react";
import { formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { isModelCostUnknown, type MergedUsage, type ModelTotals } from "@t3tools/shared/usageMerge";
import { useEffect } from "react";

import {
  mergeAnsweredUsage,
  selectUsageModel,
  selectedUsageModelKeyAtom,
  type EnvironmentUsageStatus,
} from "../state/usage.ts";
import {
  cacheHitRate,
  costPerMillionTokens,
  costTypeSegments,
  speedCostSegments,
  tokenTypeSegments,
} from "../web/components/usage/usageBreakdown.ts";
import type { UsageChartMetric } from "../web/components/usage/usageChart.ts";
import { PROVIDER_PRESENTATION } from "../web/components/usage/usageProviders.ts";
import { Button, Text } from "../ui/primitives.tsx";
import { useTheme } from "../ui/theme.ts";
import { ProviderGlyph } from "./ProviderMark.tsx";
import { UsageDialog } from "./UsageDialog.tsx";
import { UsageProviderChart } from "./UsageProviderChart.tsx";
import { SpeedPremium, UsageShareBar } from "./UsageShareBar.tsx";

export interface UsageChartWindow {
  readonly days: readonly string[];
  readonly hours: readonly string[];
  readonly resolution: "day" | "hour";
  readonly timeZone: string;
  readonly referenceTime: string | undefined;
  readonly hour12: boolean;
}

export function UsageModelDialogHost({
  models,
  onSetPrice,
  ...dialogProps
}: {
  readonly models: MergedUsage["models"];
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly metric: UsageChartMetric;
  readonly chartWindow: UsageChartWindow;
  readonly onSetPrice: (model: string) => void;
}) {
  const selectedKey = useAtomValue(selectedUsageModelKeyAtom);
  useEffect(() => () => selectUsageModel(null), []);
  const model =
    selectedKey === null
      ? undefined
      : models.find((candidate) => `${candidate.provider}:${candidate.model}` === selectedKey);
  if (model === undefined) return null;
  return (
    <UsageModelDialog
      {...dialogProps}
      model={model}
      onSetPrice={() => {
        selectUsageModel(null);
        onSetPrice(model.model);
      }}
      onClose={() => selectUsageModel(null)}
    />
  );
}

export function UsageModelDialog({
  model,
  environments,
  metric,
  chartWindow,
  onSetPrice,
  onClose,
}: {
  readonly model: ModelTotals;
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly metric: UsageChartMetric;
  readonly chartWindow: UsageChartWindow;
  readonly onSetPrice: () => void;
  readonly onClose: () => void;
}) {
  const theme = useTheme();
  const usage = mergeAnsweredUsage(
    environments,
    (bucket) => bucket.provider === model.provider && bucket.model === model.model,
  );
  const providers = [model.provider];
  const presentation = PROVIDER_PRESENTATION[model.provider];
  const costUnknown = isModelCostUnknown(model);
  const hitRate = cacheHitRate(model);
  const perMillion = costPerMillionTokens(model);
  const stats = [
    { label: "Cost", value: costUnknown ? "Unpriced" : formatUsd(model.costUsd) },
    { label: "Tokens", value: formatTokens(model.totalTokens) },
    perMillion === null ? null : { label: "Per 1M tokens", value: formatUsd(perMillion) },
    hitRate === null ? null : { label: "Cache hit", value: formatPercent(hitRate) },
  ].filter((stat) => stat !== null);
  const shareBars = [
    costUnknown ? null : (
      <UsageShareBar key="cost" label="Cost by type" segments={costTypeSegments(usage.categoryCost)} format={formatUsd} />
    ),
    <UsageShareBar key="tokens" label="Tokens by type" segments={tokenTypeSegments(model.tokens)} format={formatTokens} />,
    usage.speedCost.fast + usage.speedCost.ultrafast > 0 ? (
      <UsageShareBar
        key="speed"
        label="Cost by speed"
        segments={speedCostSegments(usage.speedCost)}
        format={formatUsd}
        aside={<SpeedPremium premiumUsd={usage.speedCost.premium} format={formatUsd} />}
      />
    ) : null,
  ].filter((bar) => bar !== null);
  const barRows: (typeof shareBars)[] = [];
  for (let index = 0; index < shareBars.length; index += 2) barRows.push(shareBars.slice(index, index + 2));

  return (
    <UsageDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      testId="usage-model-dialog"
      width={768}
      title={model.model}
      titleIcon={<ProviderGlyph driver={presentation.driverKind} displayName={presentation.label} size={20} />}
      description={`${presentation.label}${costUnknown ? "" : ` · ${formatPercent(model.costShare)} of cost`}`}
      footer={
        model.unpricedTokens > 0 ? (
          <>
            <Text size="xs" color={theme.mutedForeground}>
              {`${formatTokens(model.unpricedTokens)} tokens have no known price`}
            </Text>
            <Button onClick={onSetPrice} testId="usage-model-set-price">
              Set price
            </Button>
          </>
        ) : undefined
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={{ display: "flex", flexDirection: "row", columnGap: 24 }}>
          {Array.from({ length: 4 }, (_, index) => {
            const stat = stats[index];
            return (
              <div key={index} style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                {stat ? (
                  <>
                    <Text size="xs" color={theme.mutedForeground}>
                      {stat.label}
                    </Text>
                    <div>
                      <Text size="2xl" weight={600}>
                        {stat.value}
                      </Text>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Unpriced cost is unknown, not zero, so its trend shows tokens. */}
        <UsageProviderChart
          testId="usage-model-chart"
          providers={providers}
          days={chartWindow.days}
          daily={usage.daily}
          hours={chartWindow.hours}
          hourly={usage.hourly}
          metric={costUnknown ? "tokens" : metric}
          referenceTime={chartWindow.referenceTime}
          resolution={chartWindow.resolution}
          timeZone={chartWindow.timeZone}
          hour12={chartWindow.hour12}
        />

        <div style={{ display: "flex", flexDirection: "column", rowGap: 32 }}>
          {barRows.map((row, rowIndex) => (
            <div key={rowIndex} style={{ display: "flex", flexDirection: "row", columnGap: 40 }}>
              {[0, 1].map((column) => (
                <div key={column} style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                  {row[column] ?? null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </UsageDialog>
  );
}
