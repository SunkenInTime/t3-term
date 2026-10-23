// A synchronous localStorage stand-in for ported web logic. Bun has no
// localStorage, so values persist to $T3TERM_HOME/local-storage.json.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { termHome } from "../../runtime/paths.ts";

const file = () => NodePath.join(termHome(), "local-storage.json");
let cache: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(NodeFS.readFileSync(file(), "utf8"));
    cache = parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save(): void {
  NodeFS.mkdirSync(termHome(), { recursive: true });
  NodeFS.writeFileSync(file(), JSON.stringify(cache ?? {}, null, 2));
}

export const localStore = {
  getItem(key: string): string | null {
    return load()[key] ?? null;
  },
  setItem(key: string, value: string): void {
    load()[key] = value;
    save();
  },
  removeItem(key: string): void {
    delete load()[key];
    save();
  },
};
