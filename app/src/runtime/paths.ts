import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** Client-side state (connection catalog, drafts, UI prefs). Never the server's T3 home. */
export function termHome(): string {
  const configured = process.env.T3TERM_HOME?.trim();
  return configured ? configured : NodePath.join(NodeOS.homedir(), ".t3-term");
}
