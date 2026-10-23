// The "When" clause editor of apps/web/src/components/settings/KeybindingsSettings.tsx
// (WhenExpressionBuilder, WhenExpressionNodeEditor, WhenClauseControl): a text
// expression plus a visual tree of conditions and and/or groups.
import type { KeybindingWhenNode } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { Popover } from "../../ui/overlay.tsx";
import { Text } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  DEFAULT_WHEN_VARIABLE,
  isKnownWhenVariable,
  parseWhenExpressionDraft,
  unknownWhenVariables,
  whenAstToExpression,
  whenNodeRemoveLabel,
  type WhenVariableOption,
} from "../../web/components/settings/KeybindingsSettings.logic.ts";
import { fieldBackground, setTextEntryFocused } from "../controls.tsx";
import { CompactButton, GhostIconButton, MicroTrigger, NotToggle, PickerSelect, WarningIcon } from "./parts.tsx";

type BooleanOperator = "and" | "or";

function flattenWhenChildren(node: KeybindingWhenNode, operator: BooleanOperator): KeybindingWhenNode[] {
  if (node.type !== operator) return [node];
  return [...flattenWhenChildren(node.left, operator), ...flattenWhenChildren(node.right, operator)];
}

function buildWhenExpressionGroup(
  children: readonly KeybindingWhenNode[],
  operator: BooleanOperator,
): KeybindingWhenNode | undefined {
  const first = children[0];
  if (!first) return undefined;
  return children.slice(1).reduce<KeybindingWhenNode>((left, right) => ({ type: operator, left, right }), first);
}

function conditionParts(node: KeybindingWhenNode): { identifier: string; negated: boolean } | null {
  if (node.type === "identifier") return { identifier: node.name, negated: false };
  if (node.type === "not" && node.node.type === "identifier") return { identifier: node.node.name, negated: true };
  return null;
}

function setConditionIdentifier(node: KeybindingWhenNode, identifier: string): KeybindingWhenNode {
  const parts = conditionParts(node);
  if (!parts) return node;
  const next: KeybindingWhenNode = { type: "identifier", name: identifier };
  return parts.negated ? { type: "not", node: next } : next;
}

function setConditionNegated(node: KeybindingWhenNode, negated: boolean): KeybindingWhenNode {
  const parts = conditionParts(node);
  if (!parts) return negated ? { type: "not", node } : node;
  const identifier: KeybindingWhenNode = { type: "identifier", name: parts.identifier };
  return negated ? { type: "not", node: identifier } : identifier;
}

function defaultWhenCondition(): KeybindingWhenNode {
  return { type: "identifier", name: DEFAULT_WHEN_VARIABLE };
}

function defaultWhenGroup(operator: BooleanOperator = "and"): KeybindingWhenNode {
  return { type: operator, left: defaultWhenCondition(), right: { type: "not", node: defaultWhenCondition() } };
}

function unknownLabel(identifiers: ReadonlyArray<string>): string {
  return identifiers.length === 1
    ? `Unknown condition: ${identifiers[0]}`
    : `Unknown conditions: ${identifiers.join(", ")}`;
}

/** UnknownWhenVariableWarning; the tooltip carries the web's longer explanation. */
function UnknownWhenVariableWarning({ identifiers }: { identifiers: ReadonlyArray<string> }) {
  if (identifiers.length === 0) return null;
  return (
    <WarningIcon
      size={18}
      label={`${unknownLabel(identifiers)}. T3 Code does not recognize this condition yet. It can still be saved, but it may not match unless the runtime provides it.`}
    />
  );
}

/** The tree guide in front of each child: a vertical rule and a short tick into the child. */
function TreeGutter({ strong }: { strong: boolean }) {
  const theme = useTheme();
  const color = strong ? theme.border : alpha(theme.border, 0.7);
  return (
    <div style={{ position: "relative", width: 16, alignSelf: "stretch", flexShrink: 0 }}>
      <div style={{ position: "absolute", left: 6, top: 0, bottom: 0, width: 1, backgroundColor: color }} />
      <div style={{ position: "absolute", left: 6, top: 16, width: 10, height: 1, backgroundColor: color }} />
    </div>
  );
}

function TreeChild({ strong, children }: { strong: boolean; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "row" }}>
      <TreeGutter strong={strong} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function WhenExpressionNodeEditor({
  node,
  variables,
  depth = 0,
  path,
  onChange,
  onRemove,
}: {
  node: KeybindingWhenNode;
  variables: ReadonlyArray<WhenVariableOption>;
  depth?: number;
  path: string;
  onChange: (node: KeybindingWhenNode) => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const condition = conditionParts(node);

  if (condition) {
    const unknownIdentifiers = isKnownWhenVariable(condition.identifier) ? [] : [condition.identifier];
    const options = variables.includes(condition.identifier) ? variables : [condition.identifier, ...variables];
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          padding: 8,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.7),
          backgroundColor: alpha(theme.background, 0.6),
        }}
      >
        <NotToggle
          testId={`when-not-${path}`}
          pressed={condition.negated}
          onChange={(pressed) => onChange(setConditionNegated(node, pressed))}
        />
        <PickerSelect
          testId={`when-variable-${path}`}
          size="compact"
          grow
          value={condition.identifier}
          options={options.map((option) => ({ value: option, label: option }))}
          onChange={(value) => onChange(setConditionIdentifier(node, value))}
          maxHeight={288}
          menuMinWidth={200}
          trailing={unknownIdentifiers.length > 0 ? <UnknownWhenVariableWarning identifiers={unknownIdentifiers} /> : null}
        />
        {onRemove ? (
          <GhostIconButton testId={`when-remove-${path}`} icon="minus" label={whenNodeRemoveLabel(node, depth)} onClick={onRemove} />
        ) : null}
      </div>
    );
  }

  const boxStyle = (nested: boolean, border: number, background: string) => ({
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 8,
    padding: 8,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: alpha(theme.border, nested ? 0.7 : border),
    backgroundColor: background,
  });

  if (node.type === "not") {
    return (
      <div
        style={boxStyle(
          depth > 0,
          0.7,
          depth > 0 ? alpha(theme.background, 0.5) : alpha(theme.muted, 0.2),
        )}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <NotToggle testId={`when-not-${path}`} pressed onChange={(pressed) => onChange(pressed ? node : node.node)} />
          <div style={{ flexGrow: 1 }} />
          {onRemove ? (
            <GhostIconButton testId={`when-remove-${path}`} icon="minus" label={whenNodeRemoveLabel(node, depth)} onClick={onRemove} />
          ) : null}
        </div>
        <TreeChild strong={false}>
          <WhenExpressionNodeEditor
            node={node.node}
            variables={variables}
            depth={depth + 1}
            path={`${path}-0`}
            onChange={(next) => onChange({ type: "not", node: next })}
          />
        </TreeChild>
      </div>
    );
  }

  const operator: BooleanOperator = node.type === "or" ? "or" : "and";
  const children = flattenWhenChildren(node, operator);
  const childKeyCounts = new Map<string, number>();
  const childEntries = children.map((child) => {
    const baseKey = `${child.type}-${whenAstToExpression(child)}`;
    const count = childKeyCounts.get(baseKey) ?? 0;
    childKeyCounts.set(baseKey, count + 1);
    return { child, key: count === 0 ? baseKey : `${baseKey}-${count}` };
  });

  const updateChild = (target: KeybindingWhenNode, next: KeybindingWhenNode) => {
    let didUpdate = false;
    const nextChildren = children.map((child) => {
      if (!didUpdate && child === target) {
        didUpdate = true;
        return next;
      }
      return child;
    });
    const nextNode = buildWhenExpressionGroup(nextChildren, operator);
    if (nextNode) onChange(nextNode);
  };

  const removeChild = (target: KeybindingWhenNode) => {
    let didRemove = false;
    const nextChildren = children.filter((child) => {
      if (!didRemove && child === target) {
        didRemove = true;
        return false;
      }
      return true;
    });
    onChange(buildWhenExpressionGroup(nextChildren, operator) ?? defaultWhenCondition());
  };

  const setOperator = (nextOperator: BooleanOperator) => {
    if (nextOperator === operator) return;
    const nextNode = buildWhenExpressionGroup(children, nextOperator);
    if (nextNode) onChange(nextNode);
  };

  const addCondition = () => {
    const nextNode = buildWhenExpressionGroup([...children, defaultWhenCondition()], operator);
    if (nextNode) onChange(nextNode);
  };

  const addGroup = () => {
    const nestedOperator: BooleanOperator = operator === "and" ? "or" : "and";
    const nextNode = buildWhenExpressionGroup([...children, defaultWhenGroup(nestedOperator)], operator);
    if (nextNode) onChange(nextNode);
  };

  return (
    <div style={boxStyle(depth > 0, 0.6, depth > 0 ? alpha(theme.background, 0.55) : alpha(theme.muted, 0.1))}>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <PickerSelect
          testId={`when-operator-${path}`}
          size="compact"
          width={144}
          value={operator}
          options={[
            { value: "and", label: "and" },
            { value: "or", label: "or" },
          ]}
          onChange={setOperator}
        />
        <CompactButton testId={`when-add-condition-${path}`} onClick={addCondition}>
          Condition
        </CompactButton>
        <CompactButton testId={`when-add-group-${path}`} onClick={addGroup}>
          Group
        </CompactButton>
        <div style={{ flexGrow: 1 }} />
        {onRemove ? (
          <GhostIconButton testId={`when-remove-${path}`} icon="minus" label={whenNodeRemoveLabel(node, depth)} onClick={onRemove} />
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {childEntries.map(({ child, key }, index) => (
          <TreeChild key={key} strong={depth === 0}>
            <WhenExpressionNodeEditor
              node={child}
              variables={variables}
              depth={depth + 1}
              path={`${path}-${index}`}
              onChange={(next) => updateChild(child, next)}
              onRemove={() => removeChild(child)}
            />
          </TreeChild>
        ))}
      </div>
    </div>
  );
}

function WhenExpressionBuilder({
  value,
  variables,
  onChange,
  onValidityChange,
}: {
  value: KeybindingWhenNode | undefined;
  variables: ReadonlyArray<WhenVariableOption>;
  onChange: (value: KeybindingWhenNode | undefined) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const theme = useTheme();
  const [expressionDraft, setExpressionDraft] = useState(() => whenAstToExpression(value));
  const [focused, setFocused] = useState(false);
  const parseResult = parseWhenExpressionDraft(expressionDraft);
  const parseError = parseResult.ok ? null : parseResult.message;
  const unknownIdentifiers = parseResult.ok ? unknownWhenVariables(parseResult.value) : [];

  const updateExpressionDraft = (nextExpression: string) => {
    setExpressionDraft(nextExpression);
    const nextResult = parseWhenExpressionDraft(nextExpression);
    onValidityChange?.(nextResult.ok);
    if (nextResult.ok) onChange(nextResult.value);
  };

  const updateExpressionValue = (nextValue: KeybindingWhenNode | undefined) => {
    setExpressionDraft(whenAstToExpression(nextValue));
    onValidityChange?.(true);
    onChange(nextValue);
  };

  const addRootCondition = () =>
    updateExpressionValue(value ? { type: "and", left: value, right: defaultWhenCondition() } : defaultWhenCondition());
  const addRootGroup = () => {
    const group = defaultWhenGroup("or");
    updateExpressionValue(value ? { type: "and", left: value, right: group } : group);
  };

  // The web's InputGroup matches `input[aria-invalid]` by presence, so the
  // field always wears the destructive/36 border; brighter while focused.
  const fieldBorder = alpha(theme.error, focused ? 0.64 : 0.36);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 544 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <Text weight={500}>When</Text>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <CompactButton testId="when-root-add-condition" onClick={addRootCondition}>
            Condition
          </CompactButton>
          <CompactButton testId="when-root-add-group" onClick={addRootGroup}>
            Group
          </CompactButton>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: 30,
            paddingLeft: 9,
            paddingRight: unknownIdentifiers.length > 0 ? 4 : 9,
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderColor: fieldBorder,
            backgroundColor: fieldBackground(theme),
          }}
        >
          <input
            testId="when-expression"
            value={expressionDraft}
            placeholder="Always"
            theme={{ caret: theme.foreground, textMuted: theme.mutedForeground, appearance: theme.appearance }}
            onChange={(event) => updateExpressionDraft(event.value ?? "")}
            onFocus={() => {
              setFocused(true);
              setTextEntryFocused(true);
            }}
            onBlur={() => {
              setFocused(false);
              setTextEntryFocused(false);
            }}
            style={{ flexGrow: 1, minWidth: 0, height: 26, fontSize: 12, lineHeight: 26, color: theme.foreground, fontFamily: FONTS.mono }}
          />
          <UnknownWhenVariableWarning identifiers={unknownIdentifiers} />
        </div>
        {parseError ? (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="circle-x" size={14} color={theme.errorForeground} />
            <Text size="2xs" color={theme.errorForeground}>
              {parseError}
            </Text>
          </div>
        ) : null}
      </div>

      <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
        {value ? (
          <WhenExpressionNodeEditor node={value} variables={variables} path="root" onChange={updateExpressionValue} onRemove={() => updateExpressionValue(undefined)} />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              padding: 12,
              borderRadius: RADIUS.md,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: alpha(theme.border, 0.8),
              backgroundColor: alpha(theme.muted, 0.15),
            }}
          >
            <CompactButton testId="when-empty-add-condition" variant="default" onClick={addRootCondition}>
              Condition
            </CompactButton>
            <CompactButton testId="when-empty-add-group" onClick={addRootGroup}>
              Group
            </CompactButton>
          </div>
        )}
        {parseError ? (
          // The visual editor stays inert until the text parses again.
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
              borderRadius: RADIUS.lg,
              borderWidth: 1,
              borderColor: alpha(theme.error, 0.3),
              backgroundColor: theme.appearance === "dark" ? "#141414f2" : alpha(theme.background, 0.92),
            }}
          >
            <Text size="xs" color={theme.errorForeground} style={{ textAlign: "center" }}>
              Fix the expression above to continue editing visually.
            </Text>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** WhenClauseControl: the "When" micro button and its builder popover. */
export function WhenClauseControl({
  label,
  expression,
  value,
  variables,
  onChange,
  onValidityChange,
  testId,
}: {
  label: string;
  expression: string;
  value: KeybindingWhenNode | undefined;
  variables: ReadonlyArray<WhenVariableOption>;
  onChange: (value: KeybindingWhenNode | undefined) => void;
  onValidityChange: (valid: boolean) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  void label;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      sideOffset={6}
      testId={testId ? `${testId}-popover` : undefined}
      rootStyle={{ flexShrink: 0 }}
      style={{ padding: 16, pointerEvents: "auto" }}
      trigger={
        <MicroTrigger testId={testId} label={expression || "Always"} muted={!expression} open={open} onClick={() => setOpen(!open)} />
      }
    >
      <WhenExpressionBuilder value={value} variables={variables} onChange={onChange} onValidityChange={onValidityChange} />
    </Popover>
  );
}
