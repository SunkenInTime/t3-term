// A keep-alive atom whose value survives restarts as one JSON file under
// $T3TERM_HOME/ui. The web client keeps the same state in localStorage.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { termHome } from "../runtime/paths.ts";

const WRITE_DELAY_MS = 250;

export function persistedAtom<A>(
  name: string,
  initial: A,
  decode: (raw: unknown) => A,
): Atom.Writable<A> {
  const file = NodePath.join(termHome(), "ui", `${name}.json`);
  let loaded = initial;
  try {
    loaded = decode(JSON.parse(NodeFS.readFileSync(file, "utf8")));
  } catch {
    // Missing or unreadable state starts from the default, like an empty localStorage key.
  }
  const atom = Atom.make<A>(loaded).pipe(Atom.keepAlive);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A = loaded;
  appAtomRegistry.subscribe(atom, (value) => {
    pending = value;
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
        NodeFS.writeFileSync(file, JSON.stringify(pending));
      } catch (error) {
        console.error(`Could not save ${name}`, error);
      }
    }, WRITE_DELAY_MS);
  });
  return atom;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
