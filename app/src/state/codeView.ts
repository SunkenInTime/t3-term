// Code view preferences shared by the Diff and Files surfaces. The web client
// keeps both in client settings (`diffLayout`, default "stacked"; `wordWrap`,
// default true). When the client settings store lands (feat/settings,
// state/clientSettings.ts), these become `clientSettingAtom("diffLayout")` and
// `clientSettingAtom("wordWrap")` with `updateClientSettings`.
import { appAtomRegistry } from "../runtime/runtime.ts";
import { persistedAtom } from "./persistedAtom.ts";

export type DiffLayoutPreference = "stacked" | "split";

const diffLayoutAtom = persistedAtom<DiffLayoutPreference>("diff-layout", "stacked", (raw) => (raw === "split" ? "split" : "stacked"));
const wordWrapAtom = persistedAtom<boolean>("word-wrap", true, (raw) => (typeof raw === "boolean" ? raw : true));

export const diffLayoutPref = {
  atom: diffLayoutAtom,
  set: (value: DiffLayoutPreference) => appAtomRegistry.set(diffLayoutAtom, value),
};

export const wordWrapPref = {
  atom: wordWrapAtom,
  set: (value: boolean) => appAtomRegistry.set(wordWrapAtom, value),
};
