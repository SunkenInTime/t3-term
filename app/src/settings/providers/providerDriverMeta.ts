// The provider driver registry apps/web/src/components/settings/providerDriverMeta.ts
// builds. The provider-* packages are not workspace dependencies of t3-term, so their
// client definitions and settings schemas are copied here verbatim from
// packages/provider-{core,cursor,grok,opencode,muse,pi,acp-registry}/src/{client,settings}.ts.
// Codex, Claude and Antigravity schemas come from @t3tools/contracts as on web.
import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  CustomModelSetting,
  makeBinaryPathSetting,
  makeProviderSettingsSchema,
  ProviderDriverKind,
  secretSetting,
  TrimmedString,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

// ── packages/provider-core/src/client.ts ──
export type ProviderSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
} & Schema.Top;

export interface ProviderEnvironmentField {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly sensitive?: boolean;
}

export interface ProviderIcon {
  readonly viewBox: string;
  readonly fill: { readonly light: string; readonly dark: string };
  readonly paths: ReadonlyArray<{
    readonly d: string;
    readonly fillRule?: "evenodd" | "nonzero";
    readonly fill?: { readonly light: string; readonly dark: string };
    readonly gradient?: ProviderIconGradient;
  }>;
}

export interface ProviderIconGradient {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stops: ReadonlyArray<{ readonly offset: number; readonly color: string }>;
}

export interface ProviderClientDefinition {
  readonly driverKind: ProviderDriverKind;
  readonly label: string;
  readonly icon?: ProviderIcon;
  readonly settingsSchema: ProviderSettingsSchema;
  readonly environmentFields?: ReadonlyArray<ProviderEnvironmentField>;
  readonly hasDefaultInstance?: boolean;
  readonly badgeLabel?: string;
}

export function defineProviderClient<const Definition extends ProviderClientDefinition>(
  definition: Definition,
): Definition {
  return definition;
}

export interface ProviderClientRegistry {
  readonly definitions: ReadonlyArray<ProviderClientDefinition>;
  readonly get: (
    driverKind: ProviderDriverKind | undefined,
  ) => ProviderClientDefinition | undefined;
}

export function makeProviderClientRegistry(
  definitions: ReadonlyArray<ProviderClientDefinition>,
): ProviderClientRegistry {
  const byDriverKind = new Map<ProviderDriverKind, ProviderClientDefinition>();
  for (const definition of definitions) {
    if (byDriverKind.has(definition.driverKind)) {
      throw new Error(`Provider driver '${definition.driverKind}' is defined more than once.`);
    }
    byDriverKind.set(definition.driverKind, definition);
  }
  return {
    definitions,
    get: (driverKind) => (driverKind === undefined ? undefined : byDriverKind.get(driverKind)),
  };
}

// ── packages/provider-cursor/src/settings.ts ──
export const CursorSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    // Keep V1's CLI configuration when V2 rewrites the shared settings file.
    // V2's Cursor SDK does not use these fields.
    binaryPath: Schema.optionalKey(TrimmedString).pipe(
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    apiEndpoint: Schema.optionalKey(TrimmedString).pipe(
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: [],
  },
);
export type CursorSettings = typeof CursorSettings.Type;

// ── packages/provider-cursor/src/client.ts ──
export const cursorClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("cursor"),
  label: "Cursor",
  settingsSchema: CursorSettings,
  environmentFields: [
    {
      name: "CURSOR_API_KEY",
      label: "Cursor API key",
      description: "Optional. Overrides browser sign-in for this provider.",
      placeholder: "Paste API key",
      sensitive: true,
    },
  ],
  icon: {
    viewBox: "0 0 466.73 532.09",
    fill: { light: "#26251E", dark: "#EDECEC" },
    paths: [
      {
        d: "M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z",
      },
    ],
  },
});

// ── packages/provider-grok/src/settings.ts ──
export const GrokSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("grok").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Grok CLI binary.",
        providerSettingsForm: { placeholder: "grok", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath"],
  },
);
export type GrokSettings = typeof GrokSettings.Type;

// ── packages/provider-grok/src/client.ts ──
export const grokClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("grok"),
  label: "Grok",
  settingsSchema: GrokSettings,
  icon: {
    viewBox: "0 0 24 24",
    fill: { light: "#0F0F0F", dark: "#F5F5F5" },
    paths: [
      {
        d: "M9.26905 15.284L17.2479 9.36086C17.6391 9.07047 18.1981 9.18374 18.3845 9.63478C19.3655 12.0135 18.9272 14.8721 16.9755 16.8349C15.0238 18.7976 12.3082 19.228 9.8261 18.2477L7.1146 19.5102C11.0037 22.1834 15.7263 21.5223 18.6774 18.5525C21.0182 16.1985 21.7432 12.9897 21.0653 10.0961L21.0714 10.1023C20.0884 5.85143 21.3131 4.15233 23.8218 0.677913C23.8812 0.595532 23.9406 0.513151 24 0.428711L20.6987 3.74866V3.73836L9.267 15.2861",
      },
      {
        d: "M7.62249 16.7237C4.83113 14.0422 5.3124 9.89222 7.69417 7.49905C9.45541 5.72786 12.341 5.00497 14.86 6.06768L17.5653 4.81138C17.0779 4.45714 16.4533 4.07613 15.7365 3.80839C12.4966 2.46764 8.6178 3.13492 5.98413 5.78141C3.45081 8.32904 2.65415 12.2463 4.02219 15.5889C5.04412 18.0871 3.36889 19.8541 1.68137 21.6377C1.08337 22.2699 0.483318 22.9022 0 23.5716L7.62045 16.7257",
      },
    ],
  },
});

// ── packages/provider-opencode/src/settings.ts ──
export const OpenCodeSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("opencode").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the OpenCode binary.",
        providerSettingsForm: {
          placeholder: "opencode",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    serverUrl: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Server URL",
        description: "Leave blank to let T3 Code spawn the server when needed.",
        providerSettingsForm: {
          placeholder: "http://127.0.0.1:4096",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    serverPassword: TrimmedString.pipe(
      secretSetting,
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Server password",
        description: "Stored separately on the host.",
        providerSettingsForm: {
          control: "password",
          placeholder: "Optional",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "serverUrl", "serverPassword"],
  },
);
export type OpenCodeSettings = typeof OpenCodeSettings.Type;

// ── packages/provider-opencode/src/client.ts ──
export const openCodeClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("opencode"),
  label: "OpenCode",
  settingsSchema: OpenCodeSettings,
  icon: {
    viewBox: "0 0 32 40",
    fill: { light: "#211E1E", dark: "#F1ECEC" },
    paths: [
      { d: "M24 32H8V16H24V32Z", fill: { light: "#CFCECD", dark: "#4B4646" } },
      { d: "M24 8H8V32H24V8ZM32 40H0V0H32V40Z" },
    ],
  },
});

// ── packages/provider-muse/src/settings.ts ──
export const MuseSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("muse").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description:
          "Path to the Muse Code binary on this environment. Sign in with muse login on that host.",
        providerSettingsForm: { placeholder: "muse", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  { order: ["binaryPath"] },
);
export type MuseSettings = typeof MuseSettings.Type;

// ── packages/provider-muse/src/client.ts ──
export const museClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("muse"),
  label: "Muse Code",
  settingsSchema: MuseSettings,
  badgeLabel: "Beta",
  icon: {
    viewBox: "0 0 287.56 191",
    fill: { light: "#0081fb", dark: "#0081fb" },
    paths: [
      {
        d: "m31.06,125.96c0,10.98 2.41,19.41 5.56,24.51 4.13,6.68 10.29,9.51 16.57,9.51 8.1,0 15.51-2.01 29.79-21.76 11.44-15.83 24.92-38.05 33.99-51.98l15.36-23.6c10.67-16.39 23.02-34.61 37.18-46.96 11.56-10.08 24.03-15.68 36.58-15.68 21.07,0 41.14,12.21 56.5,35.11 16.81,25.08 24.97,56.67 24.97,89.27 0,19.38-3.82,33.62-10.32,44.87-6.28,10.88-18.52,21.75-39.11,21.75l0-31.02c17.63,0 22.03-16.2 22.03-34.74 0-26.42-6.16-55.74-19.73-76.69-9.63-14.86-22.11-23.94-35.84-23.94-14.85,0-26.8,11.2-40.23,31.17-7.14,10.61-14.47,23.54-22.7,38.13l-9.06,16.05c-18.2,32.27-22.81,39.62-31.91,51.75-15.95,21.24-29.57,29.29-47.5,29.29-21.27,0-34.72-9.21-43.05-23.09-6.8-11.31-10.14-26.15-10.14-43.06z",
      },
      {
        d: "m24.49,37.3c14.24-21.95 34.79-37.3 58.36-37.3 13.65,0 27.22,4.04 41.39,15.61 15.5,12.65 32.02,33.48 52.63,67.81l7.39,12.32c17.84,29.72 27.99,45.01 33.93,52.22 7.64,9.26 12.99,12.02 19.94,12.02 17.63,0 22.03-16.2 22.03-34.74l27.4-.86c0,19.38-3.82,33.62-10.32,44.87-6.28,10.88-18.52,21.75-39.11,21.75-12.8,0-24.14-2.78-36.68-14.61-9.64-9.08-20.91-25.21-29.58-39.71l-25.79-43.08c-12.94-21.62-24.81-37.74-31.68-45.04-7.39-7.85-16.89-17.33-32.05-17.33-12.27,0-22.69,8.61-31.41,21.78z",
        gradient: {
          x1: 61,
          y1: 117,
          x2: 259,
          y2: 127,
          stops: [
            { offset: 0, color: "#0064e1" },
            { offset: 0.4, color: "#0064e1" },
            { offset: 0.83, color: "#0073ee" },
            { offset: 1, color: "#0082fb" },
          ],
        },
      },
      {
        d: "m82.35,31.23c-12.27,0-22.69,8.61-31.41,21.78-12.33,18.61-19.88,46.33-19.88,72.95 0,10.98 2.41,19.41 5.56,24.51l-26.48,17.44c-6.8-11.31-10.14-26.15-10.14-43.06 0-30.75 8.44-62.8 24.49-87.55 14.24-21.95 34.79-37.3 58.36-37.3z",
        gradient: {
          x1: 45,
          y1: 139,
          x2: 45,
          y2: 66,
          stops: [
            { offset: 0, color: "#0082fb" },
            { offset: 1, color: "#0064e0" },
          ],
        },
      },
    ],
  },
});

// ── packages/provider-pi/src/settings.ts ──
export const PiSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("pi").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Pi coding agent binary.",
        providerSettingsForm: { placeholder: "pi", clearWhenEmpty: "omit" },
      }),
    ),
    launchArgs: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Launch arguments",
        description: "Additional CLI arguments passed to pi --mode rpc on session start.",
        providerSettingsForm: { clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "launchArgs"],
  },
);
export type PiSettings = typeof PiSettings.Type;

// ── packages/provider-pi/src/client.ts ──
export const piClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("pi"),
  label: "Pi",
  settingsSchema: PiSettings,
  icon: {
    viewBox: "165.29 165.29 469.43 469.43",
    fill: { light: "#0F0F0F", dark: "#F5F5F5" },
    paths: [
      {
        d: "M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z",
        fillRule: "evenodd",
      },
      { d: "M517.36 400H634.72V634.72H517.36Z" },
    ],
  },
});

// ── packages/provider-acp-registry/src/settings.ts ──
export const AcpRegistryDistributionPreference = Schema.Literals(["auto", "binary", "npx", "uvx"]);
export type AcpRegistryDistributionPreference = typeof AcpRegistryDistributionPreference.Type;

export const AcpRegistrySettings = makeProviderSettingsSchema(
  {
    source: Schema.Literals(["registry", "local"]).pipe(
      Schema.withDecodingDefault(Effect.succeed("registry")),
      Schema.annotateKey({
        title: "ACP source",
        providerSettingsForm: {
          control: "select",
          options: [
            { value: "registry", label: "ACP Registry" },
            { value: "local", label: "Local command" },
          ],
        },
      }),
    ),
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    agentId: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Registry agent ID",
        description: "Agent identifier from the official ACP Registry, for example 'devin'.",
        providerSettingsForm: { placeholder: "devin", clearWhenEmpty: "persist" },
      }),
    ),
    commandPath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Executable override",
        description:
          "Executable on this environment. For registry agents, this overrides the distribution executable while keeping its arguments and environment.",
        providerSettingsForm: { placeholder: "Registry default", clearWhenEmpty: "omit" },
      }),
    ),
    commandArgs: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    authMethodId: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Authentication method",
        description:
          "Optional ACP authentication method ID. By default, the first agent-managed method is selected.",
        providerSettingsForm: { placeholder: "auto", clearWhenEmpty: "omit" },
      }),
    ),
    distribution: AcpRegistryDistributionPreference.pipe(
      Schema.withDecodingDefault(Effect.succeed("auto")),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["source", "agentId", "commandPath", "authMethodId"],
  },
);
export type AcpRegistrySettings = typeof AcpRegistrySettings.Type;

// ── packages/provider-acp-registry/src/client.ts ──
export const acpRegistryClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("acpRegistry"),
  label: "ACP Registry",
  settingsSchema: AcpRegistrySettings,
  hasDefaultInstance: false,
  icon: {
    viewBox: "0 0 576 220",
    fill: { light: "#000000", dark: "#FFFFFF" },
    paths: [
      {
        d: "M568.003 115.821L517.278 27.9661C507.183 10.4816 489.084 0.0227367 468.894 0.0227367C448.727 0.0227367 430.674 10.4361 420.556 27.8752L343.251 161.749H242.755C236.23 161.749 230.386 158.384 227.135 152.745C223.861 147.106 223.861 140.376 227.135 134.715L277.861 46.8603C281.112 41.2216 286.955 37.8338 293.481 37.8338C300.006 37.8338 305.827 41.1988 309.101 46.8603L312.125 52.0897C313.353 54.2042 315.604 55.5002 318.036 55.5002C320.469 55.5002 322.743 54.1815 323.948 52.067L337.385 28.5118C338.795 26.0335 338.522 22.9413 336.703 20.7586C325.699 7.57131 309.874 0 293.322 0C292.662 0 292.003 0 291.321 0.0454733C272.04 0.75031 254.76 11.1864 245.074 27.9434L200.215 105.657L155.81 29.1484C145.465 11.2092 126.594 0.0227367 106.608 0.0227367C105.949 0.0227367 105.289 0.0227367 104.607 0.06821C85.3265 0.773047 68.0467 11.2092 58.3608 27.9661L7.65806 115.821C-6.25678 139.899 -0.868187 168.82 21.05 187.759C29.8945 195.422 41.6039 199.628 54.0181 199.628H148.648C151.081 199.628 153.332 198.332 154.56 196.217L168.52 172.026C169.748 169.911 169.748 167.319 168.52 165.205C167.292 163.09 165.041 161.794 162.608 161.794H56.0417C49.5163 161.794 43.6729 158.429 40.4216 152.79C37.1475 147.152 37.1475 140.422 40.4216 134.76L91.1471 46.9057C94.3985 41.2671 100.242 37.8793 106.767 37.8793C113.293 37.8793 119.113 41.2443 122.387 46.9057L194.826 172.526C195.031 172.89 195.258 173.208 195.531 173.526C198.76 178.665 202.83 183.485 207.786 187.782C216.631 195.444 228.34 199.651 240.754 199.651H321.424L315.581 209.769C314.353 211.883 314.353 214.475 315.581 216.59C316.809 218.704 319.059 220 321.492 220H349.436C351.868 220 354.119 218.704 355.347 216.59L364.396 200.901L367.17 196.468C367.17 196.468 367.261 196.331 367.284 196.263L453.274 46.9285C456.525 41.2898 462.369 37.902 468.894 37.902C475.42 37.902 481.263 41.2671 484.514 46.9285L535.24 134.783C538.491 140.422 538.514 147.174 535.24 152.813C531.988 158.452 526.145 161.84 519.62 161.84H418.669C416.236 161.84 413.985 163.136 412.757 165.25L398.774 189.442C397.546 191.556 397.546 194.148 398.774 196.263C400.002 198.377 402.253 199.673 404.686 199.673H518.21C539.81 199.673 559.295 188.237 569.026 169.843C578.053 152.79 577.666 132.623 567.981 115.843L568.003 115.821Z",
      },
    ],
  },
});

// ── apps/web/src/components/settings/providerDriverMeta.ts ──
export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: "Codex",
    settingsSchema: CodexSettings,
  },
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    settingsSchema: ClaudeSettings,
  },
  cursorClient,
  grokClient,
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    settingsSchema: AntigravitySettings,
  },
  museClient,
  piClient,
  acpRegistryClient,
]);
