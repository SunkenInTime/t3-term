// Port of apps/web/src/components/usage/UsagePriceOverrides.tsx.
// gpuix inputs have no <datalist>; the Model ID and Map to cells draw their own
// suggestion list (SuggestionList) from the same models web lists.
import { useAtomValue } from "@effect/atom-react";
import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { serverEnvironment } from "../state/environment.ts";
import { readEnvironmentScope, usagePriceTargetsAtom, type EnvironmentUsageStatus } from "../state/usage.ts";
import { isUsagePriceEdit, USAGE_PRICE_FIELDS } from "../web/components/usage/usagePriceForm.ts";
import {
  isEmptyUsagePriceDraft,
  usageAliasCell,
  usagePriceCell,
  usagePriceTableChanges,
  usagePriceTableErrors,
  type UsagePriceDraft,
  type UsagePriceField,
} from "../web/components/usage/usagePriceTable.ts";
import { writeUsagePrices, type UsagePriceWriteResult } from "../web/components/usage/usagePriceTargets.ts";
import { Button, IconButton, Text } from "../ui/primitives.tsx";
import { Menu, Popover, Tooltip } from "../ui/overlay.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { UsageDialog } from "./UsageDialog.tsx";
import { MenuCheckboxRow, UsageMenuSeparator } from "./usageUi.tsx";

type SaveAttempt = {
  readonly drafts: readonly UsagePriceDraft[];
  readonly destinations: readonly {
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }[];
  readonly results: ReadonlyMap<EnvironmentId, UsagePriceWriteResult | { readonly status: "saving" }>;
};

// Column widths of the web table's colgroup (22%, 18%, four equal, 2.5rem).
const MODEL_COLUMN = "22%";
const ALIAS_COLUMN = "18%";
const ACTION_COLUMN = 40;

const SUGGESTION_ROW_HEIGHT = 28;
const SUGGESTION_MAX_ROWS = 8;

function PriceInput({
  value,
  placeholder,
  onChange,
  disabled,
  mono,
  testId,
  suggestions,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  mono?: boolean;
  testId?: string;
  /** web <datalist>: models offered while the field has focus, filtered by what is typed. */
  suggestions?: readonly string[];
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);
  const query = value.trim().toLowerCase();
  // Chromium's datalist: every option on an empty field, substring matches after, nothing once the value is an option.
  const matches =
    suggestions === undefined || suggestions.some((option) => option === value)
      ? []
      : suggestions.filter((option) => query === "" || option.toLowerCase().includes(query));
  const open = focused && !dismissed && !disabled && matches.length > 0;
  const noteFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setFocused(true);
    setDismissed(false);
  };
  const pick = (option: string) => {
    onChange(option);
    setDismissed(true);
    setHighlighted(-1);
  };
  const input = (
    <input
      testId={testId}
      value={value}
      placeholder={placeholder}
      readOnly={disabled}
      onChange={(event) => {
        // Typing proves focus: a focus moved programmatically (or by automation) fires no onFocus.
        noteFocus();
        setHighlighted(-1);
        onChange(event.value ?? "");
      }}
      onFocus={noteFocus}
      onBlur={() => {
        // A press on a suggestion blurs the field first; let the pick land before the list goes.
        blurTimer.current = setTimeout(() => setFocused(false), 150);
      }}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "down" || event.key === "up") {
          event.preventDefault();
          const step = event.key === "down" ? 1 : -1;
          // -1 is the field itself, as in a datalist: stepping past either end returns to it.
          setHighlighted((current) => {
            const next = current + step;
            return next < -1 ? matches.length - 1 : next >= matches.length ? -1 : next;
          });
        }
      }}
      onSubmit={() => {
        const option = highlighted >= 0 ? matches[highlighted] : undefined;
        if (option !== undefined) pick(option);
      }}
      style={{
        width: "100%",
        height: 28,
        paddingLeft: 9,
        paddingRight: 9,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: theme.input,
        backgroundColor: theme.appearance === "dark" ? alpha(theme.input, 0.32) : theme.background,
        color: theme.foreground,
        fontSize: 12,
        fontFamily: mono ? FONTS.mono : FONTS.sans,
        opacity: disabled ? 0.64 : 1,
      }}
    />
  );
  if (suggestions === undefined) return input;
  // The input swallows its own presses; its wrapper still sees them (every element under the pointer does).
  const field = (
    <div style={{ display: "flex", width: "100%" }} onMouseDown={noteFocus}>
      {input}
    </div>
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setDismissed(true);
      }}
      side="bottom"
      align="start"
      sideOffset={4}
      testId={testId ? `${testId}-suggestions` : undefined}
      rootStyle={{ width: "100%" }}
      style={{ padding: 4, minWidth: 200, maxHeight: SUGGESTION_ROW_HEIGHT * SUGGESTION_MAX_ROWS + 8, overflowY: "scroll" }}
      trigger={field}
    >
      {matches.map((option, index) => (
        <div
          key={option}
          onMouseDown={() => pick(option)}
          onMouseEnter={() => setHighlighted(index)}
          style={{
            display: "flex",
            alignItems: "center",
            height: SUGGESTION_ROW_HEIGHT,
            flexShrink: 0,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: RADIUS.sm,
            backgroundColor: index === highlighted ? theme.accent : "#00000000",
            cursor: "pointer",
          }}
        >
          <text style={{ color: theme.foreground, fontSize: 13, lineHeight: 18, fontFamily: FONTS.sans, whiteSpace: "nowrap", pointerEvents: "none" }}>
            {option}
          </text>
        </div>
      ))}
    </Popover>
  );
}

export function UsagePriceOverrides({
  usage,
  initialSelectedEnvironmentIds,
  initialModel,
  onOpenChange,
}: {
  readonly usage: readonly EnvironmentUsageStatus[];
  readonly initialSelectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly initialModel?: string | undefined;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const theme = useTheme();
  const environments = useAtomValue(usagePriceTargetsAtom);
  const [selectedIds, setSelectedIds] = useState(initialSelectedEnvironmentIds);
  const selected = environments.filter(
    (environment) => selectedIds === null || selectedIds.has(environment.environmentId),
  );
  const [drafts, setDrafts] = useState<readonly UsagePriceDraft[]>(() =>
    initialModel === undefined ||
    selected.some(
      (environment) =>
        Object.hasOwn(environment.prices ?? {}, initialModel) ||
        Object.hasOwn(environment.aliases ?? {}, initialModel),
    )
      ? []
      : [{ id: "new:initial", model: initialModel, isNew: true, values: {} }],
  );
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState<SaveAttempt | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const nextRowId = useRef(0);
  const customModels = [
    ...new Set(
      selected.flatMap((environment) => [
        ...Object.keys(environment.prices ?? {}),
        ...Object.keys(environment.aliases ?? {}),
      ]),
    ),
  ].sort();
  const models = [
    ...new Set([
      ...customModels,
      ...usage
        .filter((environment) => selected.some((target) => target.environmentId === environment.environmentId))
        .flatMap((environment) => environment.summary?.buckets.map((bucket) => bucket.model) ?? []),
    ]),
  ].sort();
  // web's two datalists: unpriced models for a new row, models no environment maps yet for Map to.
  const priceModelSuggestions = models.filter((model) => !customModels.includes(model));
  const aliasModelSuggestions = models.filter((model) =>
    selected.every((environment) => !Object.hasOwn(environment.aliases ?? {}, model)),
  );
  const newModels = new Set(drafts.filter((draft) => draft.isNew).map((draft) => draft.model.trim()));
  const rows: readonly UsagePriceDraft[] = [
    ...customModels
      .filter((model) => attempt === null || !newModels.has(model))
      .map(
        (model) =>
          drafts.find((draft) => draft.id === `model:${model}`) ?? {
            id: `model:${model}`,
            model,
            isNew: false,
            values: {},
          },
      ),
    ...drafts.filter((draft) => draft.isNew),
  ];
  const stagedDrafts = drafts.filter((draft) => !isEmptyUsagePriceDraft(draft));
  const errors = usagePriceTableErrors(selected, stagedDrafts);
  for (const draft of stagedDrafts) {
    if (!draft.isNew) continue;
    if (draft.model.trim() === "") errors.set(draft.id, "Enter a model ID.");
    else if (
      attempt === null &&
      (customModels.includes(draft.model.trim()) ||
        drafts.some((other) => other.id !== draft.id && other.model.trim() === draft.model.trim()))
    )
      errors.set(draft.id, "This model already has a row. Edit its prices there.");
  }
  const failedDestinations =
    attempt?.destinations.filter(
      (destination) => attempt.results.get(destination.environmentId)?.status === "failed",
    ) ?? [];
  const locked = pending || failedDestinations.length > 0;
  const hasChanges = stagedDrafts.length > 0;
  const destinationLabel = selected.length === 1 ? selected[0]!.label : `${selected.length} environments`;
  const selectionLabel = selectedIds === null ? "All environments" : destinationLabel;
  const discard = () => {
    setDrafts([]);
    setAttempt(null);
  };
  const selectEnvironments = (ids: ReadonlySet<EnvironmentId> | null) => {
    setSelectedIds(ids);
    setAttempt(null);
  };
  const updateDraft = (draft: UsagePriceDraft) => {
    setDrafts((previous) =>
      previous.some((entry) => entry.id === draft.id)
        ? previous.map((entry) => (entry.id === draft.id ? draft : entry))
        : [...previous, draft],
    );
    setAttempt(null);
  };
  const matchesSaved = (row: UsagePriceDraft, cell: { value: string; placeholder: string }, value: string) =>
    !row.isNew && cell.placeholder !== "Mixed" && cell.placeholder !== "Unavailable" && value === cell.value;
  const updateOrDropDraft = (draft: UsagePriceDraft) => {
    if (!draft.isNew && Object.keys(draft.values).length === 0 && draft.alias === undefined)
      setDrafts((previous) => previous.filter((entry) => entry.id !== draft.id));
    else updateDraft(draft);
  };
  const editCell = (row: UsagePriceDraft, field: UsagePriceField, value: string) => {
    const values = { ...row.values, [field]: value };
    const original = usagePriceCell(selected, row.model, field);
    if (matchesSaved(row, original, value)) delete values[field];
    updateOrDropDraft({ ...row, values });
  };
  const editAlias = (row: UsagePriceDraft, value: string) => {
    const { alias: _alias, ...rest } = row;
    const original = usageAliasCell(selected, row.model);
    updateOrDropDraft(matchesSaved(row, original, value) ? rest : { ...rest, alias: value });
  };
  const save = async (retry = false) => {
    if (pending) return;
    const destinations = retry ? failedDestinations : selected;
    const edits = retry && attempt ? attempt.drafts : stagedDrafts;
    if (destinations.length === 0 || edits.length === 0) return;
    const targets = destinations.map(
      (destination) =>
        environments.find((environment) => environment.environmentId === destination.environmentId) ?? {
          ...destination,
          prices: null,
          aliases: null,
          unavailable: "Environment removed",
        },
    );
    const changes = new Map(targets.map((target) => [target.environmentId, usagePriceTableChanges(target, edits)]));
    setPending(true);
    setAttempt((previous) => ({
      drafts: edits,
      destinations: retry && previous ? previous.destinations : targets,
      results: new Map([
        ...(retry && previous ? previous.results : []),
        ...targets.map((target) => [target.environmentId, { status: "saving" } as const] as const),
      ]),
    }));
    let failed = false;
    await writeUsagePrices({
      targets: targets.map((target) => ({
        ...target,
        unavailable: target.unavailable ?? [...changes.get(target.environmentId)!.errors.values()][0] ?? null,
      })),
      changes: new Map([...changes].map(([id, plan]) => [id, plan.changes])),
      write: async (input) =>
        readEnvironmentScope(input.environmentId, AuthSettingsWriteScope)
          ? runAtomCommand(appAtomRegistry, serverEnvironment.updateSettings, input, { reportFailure: false })
          : { _tag: "Failure" },
      onResult: (environmentId, result) => {
        if (result.status === "failed") failed = true;
        setAttempt((previous) =>
          previous === null ? null : { ...previous, results: new Map(previous.results).set(environmentId, result) },
        );
      },
    });
    setPending(false);
    if (!failed) setDrafts([]);
  };

  const headCell = (label: string, width?: number | `${number}%`) => (
    <div key={label} style={{ paddingLeft: 8, paddingRight: 8, ...(width === undefined ? { flexGrow: 1, flexBasis: 0, minWidth: 0 } : { width, flexShrink: 0 }) }}>
      <Text size="xs" weight={500} style={{ whiteSpace: "nowrap" }}>
        {label}
      </Text>
    </div>
  );
  const cellStyle = (width?: number | `${number}%`) =>
    ({
      display: "flex",
      flexDirection: "column",
      padding: 8,
      ...(width === undefined ? { flexGrow: 1, flexBasis: 0, minWidth: 0 } : { width, flexShrink: 0 }),
    }) as const;

  return (
    <UsageDialog
      open
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open);
      }}
      testId="usage-price-dialog"
      width={896}
      title="Custom model prices"
      description="Prices and mappings apply to all past and future usage on the environments you select."
      footer={
        <>
          <Text size="xs" color={theme.mutedForeground}>
            {hasChanges ? `Changes apply to ${destinationLabel}` : ""}
          </Text>
          <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
            {hasChanges ? (
              <Button variant="ghost" disabled={pending} onClick={discard} testId="usage-price-discard">
                {failedDestinations.length > 0 ? "Discard pending changes" : "Discard changes"}
              </Button>
            ) : null}
            <Button
              testId="usage-price-save"
              disabled={
                pending ||
                (!hasChanges && failedDestinations.length === 0) ||
                (failedDestinations.length === 0 && (errors.size > 0 || selected.length === 0))
              }
              onClick={() => void save(failedDestinations.length > 0)}
            >
              {pending ? "Saving…" : failedDestinations.length > 0 ? "Retry failed saves" : "Save changes"}
            </Button>
          </div>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Text weight={500}>Apply to</Text>
          <Menu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            align="start"
            trigger={({ toggle }) => (
              <Button
                variant="outline"
                size="sm"
                testId="usage-price-apply-to"
                disabled={pending || hasChanges}
                trailingIcon="chevron-down"
                onClick={toggle}
              >
                {selectionLabel}
              </Button>
            )}
          >
            <MenuCheckboxRow checked={selectedIds === null} onCheckedChange={(checked) => selectEnvironments(checked ? null : new Set())}>
              All environments
            </MenuCheckboxRow>
            <UsageMenuSeparator />
            {environments.map((environment) => (
              <MenuCheckboxRow
                key={environment.environmentId}
                checked={selectedIds === null || selectedIds.has(environment.environmentId)}
                onCheckedChange={(checked) => {
                  const next = new Set(selected.map((target) => target.environmentId));
                  if (checked) next.add(environment.environmentId);
                  else next.delete(environment.environmentId);
                  selectEnvironments(next.size === environments.length ? null : next);
                }}
              >
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexGrow: 1, minWidth: 0 }}>
                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                    <Text truncate>{environment.label}</Text>
                  </div>
                  {environment.unavailable ? (
                    <Text size="xs" color={theme.mutedForeground}>
                      {environment.unavailable}
                    </Text>
                  ) : null}
                </div>
              </MenuCheckboxRow>
            ))}
          </Menu>
        </div>
        <Text size="xs" color={theme.mutedForeground}>
          USD / million tokens
        </Text>
      </div>
      {selected.length === 0 ? (
        <Text color={theme.mutedForeground}>
          {environments.length === 0
            ? "Connect an environment to set model prices."
            : "Select an environment to see and change its model prices."}
        </Text>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, overflow: "hidden", minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 40, borderBottomWidth: 1, borderColor: theme.border }}>
              {headCell("Model ID", MODEL_COLUMN)}
              {headCell("Map to", ALIAS_COLUMN)}
              {USAGE_PRICE_FIELDS.map((field) => headCell(field.label))}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: ACTION_COLUMN, flexShrink: 0 }}>
                <IconButton
                  icon="plus"
                  size={24}
                  iconSize={14}
                  testId="usage-price-add"
                  disabled={locked}
                  onClick={() => {
                    const id = `new:${nextRowId.current++}`;
                    updateDraft({ id, model: "", isNew: true, values: {} });
                  }}
                />
              </div>
            </div>
            {rows.length === 0 ? (
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 32, paddingBottom: 32 }}>
                <Text size="xs" color={theme.mutedForeground}>
                  {selected.some((environment) => environment.prices === null)
                    ? "Some environment prices are unavailable."
                    : "No custom prices or mappings. Add a row to set one."}
                </Text>
              </div>
            ) : (
              rows.map((row, rowIndex) => {
                const aliasCell = usageAliasCell(selected, row.model);
                const alias = (row.alias ?? aliasCell.value).trim();
                const error =
                  errors.has(row.id) &&
                  (row.model.trim() !== "" || Object.values(row.values).some((value) => value !== ""))
                    ? errors.get(row.id)
                    : undefined;
                return (
                  <div
                    key={row.id}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      ...(rowIndex < rows.length - 1 ? { borderBottomWidth: 1, borderColor: theme.border } : {}),
                      hover: { backgroundColor: alpha(theme.muted, 0.5) },
                    }}
                  >
                    <div style={cellStyle(MODEL_COLUMN)}>
                      {row.isNew ? (
                        <PriceInput
                          testId={`usage-price-model-${row.id}`}
                          value={row.model}
                          placeholder="Model ID"
                          suggestions={priceModelSuggestions}
                          disabled={locked}
                          onChange={(value) => updateDraft({ ...row, model: value })}
                        />
                      ) : (
                        <Text
                          size="xs"
                          color={row.removed ? theme.mutedForeground : theme.foreground}
                          style={row.removed ? { textDecoration: "line-through" } : undefined}
                        >
                          {row.model}
                        </Text>
                      )}
                      {error ? (
                        <div style={{ marginTop: 4 }}>
                          <Text size="xs" color={theme.errorForeground}>
                            {error}
                          </Text>
                        </div>
                      ) : null}
                    </div>
                    {row.removed ? (
                      <div style={{ ...cellStyle(), flexGrow: 5 }}>
                        <Text size="xs" color={theme.mutedForeground}>
                          Automatic pricing after saving
                        </Text>
                      </div>
                    ) : (
                      <>
                        <div style={cellStyle(ALIAS_COLUMN)}>
                          <PriceInput
                            value={row.alias ?? aliasCell.value}
                            placeholder={row.isNew ? "Optional" : aliasCell.placeholder}
                            suggestions={aliasModelSuggestions}
                            testId={`usage-price-alias-${row.id}`}
                            disabled={locked}
                            onChange={(value) => editAlias(row, value)}
                          />
                        </div>
                        {alias !== "" ? (
                          <div style={{ ...cellStyle(), flexGrow: 4 }}>
                            <Text size="xs" color={theme.mutedForeground}>
                              {`Counted as ${alias}`}
                            </Text>
                          </div>
                        ) : (
                          USAGE_PRICE_FIELDS.map((field) => {
                            const cell = usagePriceCell(selected, row.model, field.key);
                            const value = row.values[field.key] ?? (row.isNew ? "" : cell.value);
                            return (
                              <div key={field.key} style={cellStyle()}>
                                <PriceInput
                                  mono
                                  testId={`usage-price-${field.key}-${row.id}`}
                                  value={value}
                                  placeholder={row.isNew ? (field.optional ? "Input rate" : "0.00") : cell.placeholder}
                                  disabled={locked}
                                  onChange={(next) => {
                                    if (isUsagePriceEdit(value, next)) editCell(row, field.key, next);
                                  }}
                                />
                              </div>
                            );
                          })
                        )}
                      </>
                    )}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: ACTION_COLUMN, flexShrink: 0 }}>
                      <Tooltip content={row.removed ? "Undo reset" : row.isNew ? "Remove row" : "Reset to automatic"}>
                        <div>
                          <IconButton
                            icon={row.isNew ? "x" : "rotate-ccw"}
                            size={24}
                            iconSize={14}
                            disabled={locked}
                            onClick={() => {
                              if (row.isNew) setDrafts((previous) => previous.filter((entry) => entry.id !== row.id));
                              else if (row.removed) updateOrDropDraft({ ...row, removed: false });
                              else updateDraft({ ...row, removed: true });
                            }}
                          />
                        </div>
                      </Tooltip>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <Text size="xs" color={theme.mutedForeground}>
            {`Blank cache rates use the input price. Enter 0 for free tokens. A mapped model’s usage counts as the model it maps to.${
              selected.length > 1 ? " Mixed cells keep each environment’s rate until you edit them." : ""
            }`}
          </Text>
        </>
      )}
      {attempt ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {attempt.destinations.map((destination) => {
            const result = attempt.results.get(destination.environmentId);
            return (
              <div key={destination.environmentId} style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <Text size="xs" color={theme.mutedForeground} truncate>
                  {destination.label}
                </Text>
                <div>
                  <Text size="xs" color={result?.status === "failed" ? theme.errorForeground : theme.mutedForeground}>
                    {result?.status === "failed" ? `Not saved · ${result.error}` : result?.status === "saved" ? "Saved" : "Saving…"}
                  </Text>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </UsageDialog>
  );
}
