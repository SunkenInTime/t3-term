// Ported from apps/web/src/components/usage/usagePagePreferences.ts.
// Web keeps these in localStorage; t3-term keeps the same JSON in a file under
// $T3TERM_HOME, keyed by the web storage key.
import { UsageProviderKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { termHome } from "../../../runtime/paths.ts";

const STORAGE_KEY = "t3code:usage-page-preferences:v1";
const UsagePagePreferencesSchema = Schema.Struct({
  metric: Schema.Literals(["cost", "tokens", "limits"]),
  windowDays: Schema.Literals([1, 7, 30, 90]),
  hiddenProviders: Schema.optional(Schema.Array(UsageProviderKind)),
});
export type UsagePagePreferences = typeof UsagePagePreferencesSchema.Type;

const DEFAULT_PREFERENCES: UsagePagePreferences = { metric: "limits", windowDays: 30 };

function storagePath() {
  return NodePath.join(termHome(), "usage-page-preferences.json");
}

function getStorageItem(): UsagePagePreferences | null {
  let raw: string;
  try {
    raw = NodeFS.readFileSync(storagePath(), "utf8");
  } catch {
    return null;
  }
  const document = JSON.parse(raw) as Record<string, unknown>;
  const value = document[STORAGE_KEY];
  return value === undefined ? null : Schema.decodeUnknownSync(UsagePagePreferencesSchema)(value);
}

export function readUsagePagePreferences(): UsagePagePreferences {
  try {
    return getStorageItem() ?? DEFAULT_PREFERENCES;
  } catch (error) {
    console.error("Could not read Usage page preferences.", error);
    return DEFAULT_PREFERENCES;
  }
}

export function saveUsagePagePreferences(preferences: UsagePagePreferences): void {
  try {
    const encoded = Schema.encodeSync(UsagePagePreferencesSchema)(preferences);
    NodeFS.mkdirSync(termHome(), { recursive: true });
    NodeFS.writeFileSync(storagePath(), `${JSON.stringify({ [STORAGE_KEY]: encoded }, null, 2)}\n`);
  } catch (error) {
    console.error("Could not save Usage page preferences.", error);
  }
}
