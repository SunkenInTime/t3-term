// Finds the T3 server running on this machine (desktop app, `npx t3`, or a dev
// server) and gets a bearer token for it, the way `t3 pair` does: through the
// server's own CLI against its T3 home. Nothing here talks to a remote machine.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export interface LocalServer {
  readonly home: string;
  readonly origin: string;
  readonly serverVersion: string | undefined;
}

export function t3Home(): string {
  const configured = process.env.T3CODE_HOME?.trim();
  return configured ? configured : NodePath.join(NodeOS.homedir(), ".t3");
}

/** The server whose runtime-state file is in `home`, if its process is alive. */
export function findLocalServer(home = t3Home()): LocalServer | null {
  try {
    const raw = NodeFS.readFileSync(NodePath.join(home, "userdata", "server-runtime.json"), "utf8");
    const state = JSON.parse(raw) as { pid?: number; origin?: string; serverVersion?: string };
    if (!state.origin) return null;
    if (typeof state.pid === "number") {
      try {
        process.kill(state.pid, 0);
      } catch (error) {
        // EPERM means the process exists but belongs to someone else.
        if ((error as NodeJS.ErrnoException).code !== "EPERM") return null;
      }
    }
    return { home, origin: state.origin, serverVersion: state.serverVersion };
  } catch {
    return null;
  }
}

/**
 * The `t3` CLI that owns `home`. `T3TERM_T3_CLI` overrides it with a full
 * command line (for a dev checkout: `node <repo>/apps/server/src/bin.ts`).
 */
export function findT3Cli(home: string): ReadonlyArray<string> | null {
  const override = process.env.T3TERM_T3_CLI?.trim();
  if (override) return override.split(/\s+/);
  const candidates =
    process.platform === "win32"
      ? [NodePath.join(home, "bin", "t3.cmd"), NodePath.join(home, "bin", "t3.exe")]
      : [NodePath.join(home, "bin", "t3")];
  for (const candidate of candidates) if (NodeFS.existsSync(candidate)) return [candidate];
  const onPath = Bun.which("t3");
  return onPath ? [onPath] : null;
}

/** Issues a session token with standard scopes through the server's CLI. */
export async function issueLocalSessionToken(server: LocalServer): Promise<string> {
  const cli = findT3Cli(server.home);
  if (cli === null) throw new Error(`No t3 CLI found for ${server.home}. Pass --url and --pair instead.`);
  const label = `t3-term on ${NodeOS.hostname()}`;
  const proc = Bun.spawn(
    [...cli, "auth", "session", "issue", "--base-dir", server.home, "--token-only", "--label", label],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, T3CODE_HOME: server.home } },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const token = stdout.match(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/)?.[0];
  if (exitCode !== 0 || !token) {
    throw new Error(`t3 auth session issue failed (${exitCode}): ${stderr.trim().split("\n").at(-1) ?? ""}`);
  }
  return token;
}
