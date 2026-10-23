// Code view preferences shared by the Diff and Files surfaces. The web client
// keeps both in client settings: `diffLayout` (default "stacked") and `wordWrap`
// (default true), so they read and write the client settings store.
import { clientSettingAtom, updateClientSettings } from "./clientSettings.ts";

export type DiffLayoutPreference = "stacked" | "split";

export const diffLayoutPref = {
  atom: clientSettingAtom("diffLayout"),
  set: (value: DiffLayoutPreference) => updateClientSettings({ diffLayout: value }),
};

export const wordWrapPref = {
  atom: clientSettingAtom("wordWrap"),
  set: (value: boolean) => updateClientSettings({ wordWrap: value }),
};
