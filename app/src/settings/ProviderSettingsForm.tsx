// Port of apps/web/src/components/settings/ProviderSettingsForm.tsx (+ SecretInput.tsx):
// a form generated from a provider or source-control host settings schema.
// Shared by the Providers page and Source Control host panels.
// gpuix inputs have no password mode, so secret fields never show the stored
// value: the field starts empty and only the replacement you type is visible.
import {
  isSecretSetting,
  type ProviderSettingsFormAnnotation,
  type ProviderSettingsFormControl,
  type ProviderSettingsFormOption,
  type ProviderSettingsFormSchemaAnnotation,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useRef, useState, type ReactNode } from "react";

import { Switch } from "../ui/overlay.tsx";
import { Button, IconButton, Text } from "../ui/primitives.tsx";
import { useTheme } from "../ui/theme.ts";
import { DraftTextField, SettingsSelect, TextArea } from "./controls.tsx";
import { SettingsRow } from "./layout.tsx";

type SettingsSchema = Schema.Struct<Record<string, Schema.Top>>;

export interface SettingsFormDefinition {
  readonly settingsSchema: SettingsSchema;
  readonly driverKind?: string;
}

export interface ProviderSettingsFieldModel {
  readonly key: string;
  readonly control: ProviderSettingsFormControl;
  readonly label: string;
  readonly description?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly clearWhenEmpty: "omit" | "persist";
  readonly secret?: boolean | undefined;
  readonly defaultBooleanValue?: boolean | undefined;
  readonly options?: ReadonlyArray<ProviderSettingsFormOption> | undefined;
}

function titleizeFieldKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

type FieldSchema = SettingsSchema["fields"][string];

function readFieldAnnotations(fieldSchema: FieldSchema) {
  return (Schema.resolveAnnotationsKey(fieldSchema) ?? Schema.resolveAnnotations(fieldSchema)) as
    | Record<string, unknown>
    | undefined;
}

function readFieldAnnotationString(fieldSchema: FieldSchema, key: "title" | "description"): string | undefined {
  const value = readFieldAnnotations(fieldSchema)?.[key];
  return typeof value === "string" ? value : undefined;
}

function readFormAnnotation(fieldSchema: FieldSchema): ProviderSettingsFormAnnotation {
  return (readFieldAnnotations(fieldSchema)?.providerSettingsForm as ProviderSettingsFormAnnotation | undefined) ?? {};
}

function readSchemaAnnotation(definition: SettingsFormDefinition): ProviderSettingsFormSchemaAnnotation {
  return (
    ((Schema.resolveAnnotations(definition.settingsSchema) as Record<string, unknown> | undefined)
      ?.providerSettingsFormSchema as ProviderSettingsFormSchemaAnnotation | undefined) ?? {}
  );
}

function readFieldBooleanDefault(fieldSchema: FieldSchema): boolean | undefined {
  const decoded = Schema.decodeUnknownOption(fieldSchema as Schema.Decoder<unknown>)(undefined);
  return Option.isSome(decoded) && typeof decoded.value === "boolean" ? decoded.value : undefined;
}

export function readProviderConfigString(config: unknown, key: string): string {
  if (config === null || typeof config !== "object") return "";
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function readProviderConfigBoolean(config: unknown, key: string, defaultValue = false): boolean {
  if (config === null || typeof config !== "object") return defaultValue;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : defaultValue;
}

export function deriveProviderSettingsFields(
  definition: SettingsFormDefinition,
  value?: unknown,
): ReadonlyArray<ProviderSettingsFieldModel> {
  const isLocalAcp = definition.driverKind === "acpRegistry" && readProviderConfigString(value, "source") === "local";
  const schemaAnnotation = readSchemaAnnotation(definition);
  const orderedKeys = new Map((schemaAnnotation.order ?? []).map((key, index) => [key, index] as const));
  const offset = orderedKeys.size;
  return Object.keys(definition.settingsSchema.fields)
    .map((key, index) => ({ key, index }))
    .toSorted(
      (left, right) => (orderedKeys.get(left.key) ?? offset + left.index) - (orderedKeys.get(right.key) ?? offset + right.index),
    )
    .flatMap(({ key }) => {
      const fieldSchema = definition.settingsSchema.fields[key]!;
      const form = readFormAnnotation(fieldSchema);
      if (form.hidden) return [];
      if (isLocalAcp && key !== "source" && key !== "commandPath") return [];
      const title = readFieldAnnotationString(fieldSchema, "title");
      const description = readFieldAnnotationString(fieldSchema, "description");
      return [
        {
          key,
          control: form.control ?? "text",
          label: isLocalAcp && key === "commandPath" ? "Executable" : (title ?? titleizeFieldKey(key)),
          ...(isLocalAcp && key === "commandPath"
            ? { description: "Executable name or path on this environment." }
            : description !== undefined
              ? { description }
              : {}),
          ...(isLocalAcp && key === "commandPath"
            ? { placeholder: "e.g. dsh" }
            : form.placeholder !== undefined
              ? { placeholder: form.placeholder }
              : {}),
          clearWhenEmpty: form.clearWhenEmpty ?? "omit",
          ...(isSecretSetting(fieldSchema) ? { secret: true } : {}),
          ...(form.control === "switch" ? { defaultBooleanValue: readFieldBooleanDefault(fieldSchema) } : {}),
          ...(form.control === "select" && form.options ? { options: form.options } : {}),
        } satisfies ProviderSettingsFieldModel,
      ];
    });
}

export function nextProviderConfigWithFieldValue(
  config: unknown,
  field: ProviderSettingsFieldModel,
  value: string | boolean,
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  if (typeof value === "boolean") {
    const emptyBooleanValue = field.defaultBooleanValue ?? false;
    if (field.clearWhenEmpty === "omit" && value === emptyBooleanValue) delete base[field.key];
    else base[field.key] = value;
    return Object.keys(base).length > 0 ? base : undefined;
  }
  if (field.clearWhenEmpty === "omit" && value.trim().length === 0) delete base[field.key];
  else base[field.key] = value;
  return Object.keys(base).length > 0 ? base : undefined;
}

export interface ProviderSettingsFormProps {
  readonly definition: SettingsFormDefinition;
  readonly value: unknown;
  readonly idPrefix: string;
  readonly variant: "card" | "dialog" | "settings";
  readonly onChange: (nextConfig: Record<string, unknown> | undefined) => void;
}

/** SecretInput: the stored value never shows; Enter or blur commits a replacement. */
export function SecretField({
  configured,
  onCommit,
  placeholder,
  width,
  testId,
}: {
  configured: boolean;
  onCommit: (next: string) => void;
  placeholder?: string;
  width?: number | "100%";
  testId?: string;
}) {
  return (
    <DraftTextField
      testId={testId}
      size="sm"
      width={width}
      value=""
      placeholder={configured ? "Stored secret, enter a new value to replace" : (placeholder ?? "Not set")}
      onCommit={(next) => {
        if (configured && next === "") return;
        onCommit(next);
      }}
    />
  );
}

function FieldSelect({
  field,
  value,
  onChange,
  width,
}: {
  field: ProviderSettingsFieldModel;
  value: unknown;
  onChange: ProviderSettingsFormProps["onChange"];
  width: number | "auto";
}) {
  const options = field.options ?? [];
  const fallback = options[0]?.value ?? "";
  const current = readProviderConfigString(value, field.key) || fallback;
  return (
    <SettingsSelect
      value={current}
      width={width}
      align="start"
      options={options.map((option) => ({ value: option.value, label: option.label }))}
      onChange={(next) => onChange(nextProviderConfigWithFieldValue(value, field, next === fallback ? "" : next))}
    />
  );
}

function FieldRow({
  field,
  value,
  idPrefix,
  variant,
  onChange,
}: {
  field: ProviderSettingsFieldModel;
  value: unknown;
  idPrefix: string;
  variant: ProviderSettingsFormProps["variant"];
  onChange: ProviderSettingsFormProps["onChange"];
}) {
  const theme = useTheme();
  const testId = `${idPrefix}-${field.key}`;
  const secretConfigured = field.secret === true && readProviderConfigString(value, field.key).length > 0;
  const inlineControl =
    field.control === "switch" ? (
      <Switch
        testId={testId}
        checked={readProviderConfigBoolean(value, field.key, field.defaultBooleanValue)}
        onChange={(checked) => onChange(nextProviderConfigWithFieldValue(value, field, checked))}
      />
    ) : field.control === "select" ? (
      <FieldSelect field={field} value={value} onChange={onChange} width={variant === "settings" ? 224 : "auto"} />
    ) : field.control === "textarea" ? (
      <TextAreaField field={field} value={value} onChange={onChange} testId={testId} />
    ) : field.secret ? (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, width: variant === "settings" ? 224 : "100%" }}>
        <SecretField
          testId={testId}
          configured={secretConfigured}
          width="100%"
          onCommit={(next) => onChange(nextProviderConfigWithFieldValue(value, field, next))}
        />
        {secretConfigured ? (
          <IconButton icon="x" size={28} iconSize={14} color={theme.errorForeground} onClick={() => onChange(nextProviderConfigWithFieldValue(value, field, ""))} />
        ) : null}
      </div>
    ) : (
      <DraftTextField
        testId={testId}
        size="sm"
        width={variant === "settings" ? 224 : "100%"}
        value={readProviderConfigString(value, field.key)}
        placeholder={field.placeholder}
        onCommit={(next) => onChange(nextProviderConfigWithFieldValue(value, field, next))}
      />
    );
  if (variant === "settings") {
    return <SettingsRow title={field.label} description={field.description} control={inlineControl} />;
  }
  if (field.control === "switch") {
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Text size="xs" weight={500}>
            {field.label}
          </Text>
          {field.description ? (
            <Text size="xs" color={theme.mutedForeground}>
              {field.description}
            </Text>
          ) : null}
        </div>
        {inlineControl}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Text size="xs" weight={500}>
        {field.label}
      </Text>
      {inlineControl}
      {field.description ? (
        <Text size={variant === "dialog" ? "2xs" : "xs"} color={theme.mutedForeground}>
          {field.description}
        </Text>
      ) : null}
    </div>
  );
}

function TextAreaField({
  field,
  value,
  onChange,
  testId,
}: {
  field: ProviderSettingsFieldModel;
  value: unknown;
  onChange: ProviderSettingsFormProps["onChange"];
  testId: string;
}) {
  const saved = readProviderConfigString(value, field.key);
  const [draft, setDraft] = useState(saved);
  const [source, setSource] = useState(saved);
  if (source !== saved) {
    setSource(saved);
    setDraft(saved);
  }
  return (
    <TextArea
      testId={testId}
      value={draft}
      minRows={3}
      width={384}
      mono
      placeholder={field.placeholder}
      onChange={setDraft}
      onBlur={() => {
        if (draft !== saved) onChange(nextProviderConfigWithFieldValue(value, field, draft));
      }}
    />
  );
}

let argumentDraftId = 0;

/** ProviderCommandArguments: one literal argument per row (local ACP agents). */
function CommandArguments({ value, onChange }: Pick<ProviderSettingsFormProps, "value" | "onChange">) {
  const theme = useTheme();
  const configured =
    value !== null && typeof value === "object" ? (value as Record<string, unknown>).commandArgs : undefined;
  const args = Array.isArray(configured) ? configured.filter((arg): arg is string => typeof arg === "string") : [];
  const [rows, setRows] = useState(() => args.map((arg) => ({ id: `arg-${argumentDraftId++}`, value: arg })));
  const rowsRef = useRef(rows);
  const publish = (next: typeof rows) => {
    rowsRef.current = next;
    setRows(next);
    const config = value !== null && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
    onChange({ ...config, commandArgs: next.map((row) => row.value) });
  };
  return (
    <SettingsRow
      title="Arguments"
      description="One literal argument per row, in launch order."
      control={
        <Button size="sm" variant="outline" icon="plus" onClick={() => publish([...rowsRef.current, { id: `arg-${argumentDraftId++}`, value: "" }])}>
          Add argument
        </Button>
      }
    >
      {rows.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, paddingBottom: 8 }}>
          {rows.map((row) => (
            <div key={row.id} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
              <DraftTextField
                size="sm"
                mono
                value={row.value}
                onCommit={(next) => publish(rowsRef.current.map((current) => (current.id === row.id ? { ...current, value: next } : current)))}
              />
              <IconButton icon="x" size={20} iconSize={12} color={theme.errorForeground} onClick={() => publish(rowsRef.current.filter((current) => current.id !== row.id))} />
            </div>
          ))}
        </div>
      ) : null}
    </SettingsRow>
  );
}

export function ProviderSettingsForm({ definition, value, idPrefix, variant, onChange }: ProviderSettingsFormProps): ReactNode {
  const fields = deriveProviderSettingsFields(definition, value);
  const isLocalAcp = definition.driverKind === "acpRegistry" && readProviderConfigString(value, "source") === "local";
  if (fields.length === 0) return null;
  return (
    <>
      {fields.map((field) => (
        <FieldRow key={field.key} field={field} value={value} idPrefix={idPrefix} variant={variant} onChange={onChange} />
      ))}
      {isLocalAcp ? <CommandArguments value={value} onChange={onChange} /> : null}
    </>
  );
}
