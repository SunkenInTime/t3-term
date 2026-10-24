// OS/CLI activation, the terminal client's version of web's desktop coordinators
// (apps/web/src/components/desktop/DesktopAppActivationCoordinator.tsx and the
// prompt-link half of DesktopWebLinkCoordinator.tsx, with
// apps/web/src/desktopAppActivation.ts handleDesktopAppActivationRequest):
//
//   t3-term <folder>                   open a new thread in that folder's project,
//                                      adding the project when there is none
//   t3-term --open <t3 code link>      open a prompt link
//
// The first t3-term for a T3TERM_HOME listens on a local socket (a named pipe on
// Windows). A later invocation with one of these requests and no connection
// arguments hands the request to it and exits, the way the desktop app's second
// instance forwards its command line, so the running window picks it up.
//
// Not carried over: web links in the in-app Browser preview (the desktop browser
// runtime) and file handoff, which belong to the desktop app.
import { findProjectByPath, inferProjectTitleFromPath } from "@t3tools/client-runtime/state/projects";
import { isAtomCommandInterrupted, runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { ProjectId, type EnvironmentId } from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { startNewThread } from "../palette/actions.ts";
import { openPromptLink } from "../promptLinks/promptLinkTarget.ts";
import { termHome } from "../runtime/paths.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { environmentProjects, environmentShell, projectEnvironment } from "../state/environment.ts";
import { primaryEnvironmentIdAtom } from "../state/settings.ts";
import { environmentServerConfigsAtom } from "../state/environment.ts";
import { toast } from "../ui/toast.tsx";

export type ActivationRequest =
  | { readonly version: 1; readonly kind: "open-link"; readonly link: string }
  | { readonly version: 1; readonly kind: "open-path"; readonly path: string; readonly platform: NodeJS.Platform };

type ActivationResponse = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** A folder argument resolves against the invoking shell's directory, before it is handed on. */
export function activationRequestFromArgs(args: { readonly open?: string | undefined; readonly path?: string | undefined }): ActivationRequest | null {
  if (args.open !== undefined) return { version: 1, kind: "open-link", link: args.open };
  if (args.path !== undefined) return { version: 1, kind: "open-path", path: NodePath.resolve(args.path), platform: process.platform };
  return null;
}

function socketPath(): string {
  const id = NodeCrypto.createHash("sha256").update(NodePath.resolve(termHome()).toLowerCase()).digest("hex").slice(0, 16);
  // Unix socket paths are capped near 104 bytes, so they live in the temp dir rather than T3TERM_HOME.
  return process.platform === "win32" ? `\\\\.\\pipe\\t3term-${id}` : NodePath.join(NodeOS.tmpdir(), `t3term-${id}.sock`);
}

/**
 * Hands `request` to a running t3-term and waits for its answer. Resolves null
 * when none is listening; this invocation then opens its own window.
 */
export function forwardToRunningInstance(
  request: ActivationRequest,
  connectTimeoutMs = 1500,
  answerTimeoutMs = 60_000,
): Promise<ActivationResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    const finish = (response: ActivationResponse | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(response);
    };
    const socket = NodeNet.connect(socketPath());
    let timer = setTimeout(() => finish(null), connectTimeoutMs);
    socket.on("connect", () => {
      clearTimeout(timer);
      // The running window owns the request now; adding a project can take a while, and a
      // missing answer is reported rather than handled twice here.
      timer = setTimeout(() => finish({ ok: false, message: "The running T3 Code did not answer." }), answerTimeoutMs);
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        finish(JSON.parse(buffer.slice(0, newline)) as ActivationResponse);
      } catch {
        finish(null);
      }
    });
    socket.on("error", () => finish(null));
    socket.on("close", () => finish(null));
  });
}

let queue: Promise<unknown> = Promise.resolve();

/** Listens for forwarded requests; requests run one at a time, in arrival order. */
export function startActivationServer(): void {
  const path = socketPath();
  const server = NodeNet.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      let request: ActivationRequest;
      try {
        request = JSON.parse(buffer.slice(0, newline)) as ActivationRequest;
      } catch {
        socket.end(`${JSON.stringify({ ok: false, message: "Unreadable activation request." })}\n`);
        return;
      }
      const run = queue.then(() => handleActivationRequest(request));
      queue = run.catch(() => undefined);
      void run.then((response) => socket.end(`${JSON.stringify(response)}\n`));
    });
    socket.on("error", () => undefined);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE" || process.platform === "win32") return;
    // A socket file left by a crashed instance: nobody answers on it, so take it over.
    const probe = NodeNet.connect(path);
    probe.on("connect", () => probe.destroy());
    probe.on("error", () => {
      try {
        NodeFS.unlinkSync(path);
        server.listen(path);
      } catch {
        // Another instance owns activation for this home.
      }
    });
  });
  server.listen(path);
  server.unref();
  process.once("exit", () => {
    server.close();
    if (process.platform !== "win32") {
      try {
        NodeFS.unlinkSync(path);
      } catch {}
    }
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** web DesktopAppActivationCoordinator `ready`: the primary environment is connected and its shell is live. */
async function waitForPrimaryEnvironment(timeoutMs: number): Promise<{ environmentId: EnvironmentId; os: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const environmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
    const config = environmentId ? appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId) : undefined;
    if (environmentId && config && appAtomRegistry.get(environmentShell.stateValueAtom(environmentId)).status === "live") {
      return { environmentId, os: config.environment.platform.os };
    }
    await sleep(200);
  }
  return null;
}

async function waitForProject(environmentId: EnvironmentId, projectId: ProjectId, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (appAtomRegistry.get(environmentProjects.projectsAtom).some((project) => project.environmentId === environmentId && project.id === projectId)) return true;
    await sleep(100);
  }
  return false;
}

function failure(message: string): ActivationResponse {
  toast({ type: "error", title: "Could not open the folder", description: message });
  return { ok: false, message };
}

export async function handleActivationRequest(request: ActivationRequest): Promise<ActivationResponse> {
  if (request.kind === "open-link") {
    openPromptLink(request.link);
    return { ok: true };
  }
  const target = await waitForPrimaryEnvironment(30_000);
  if (target === null) return failure("The primary environment is not connected.");
  const requestOs = request.platform === "win32" ? "windows" : request.platform;
  if (requestOs !== target.os) {
    return failure(`The path is for ${requestOs}, but the primary environment uses ${target.os}. Cross-platform path mapping is not supported.`);
  }
  let projectId =
    findProjectByPath(
      appAtomRegistry.get(environmentProjects.projectsAtom).filter((project) => project.environmentId === target.environmentId),
      request.path,
    )?.id ?? null;
  if (projectId === null) {
    const created = ProjectId.make(crypto.randomUUID());
    const result = await runAtomCommand(appAtomRegistry, projectEnvironment.create, {
      environmentId: target.environmentId,
      input: {
        projectId: created,
        title: inferProjectTitleFromPath(request.path),
        workspaceRoot: request.path,
        createWorkspaceRootIfMissing: false,
        defaultModelSelection: null,
      },
    }, { reportFailure: false });
    if (result._tag === "Failure") {
      const error = isAtomCommandInterrupted(result) ? null : squashAtomCommandFailure(result);
      return failure(error instanceof Error && error.message.trim() ? error.message : "T3 Code could not add the project.");
    }
    if (!(await waitForProject(target.environmentId, created, 15_000))) return failure("T3 Code could not add the project.");
    projectId = created;
  }
  startNewThread(scopeProjectRef(target.environmentId, projectId));
  return { ok: true };
}
