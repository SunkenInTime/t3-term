// Headless check of the data layer: connect, then print projects and threads.
// bun src/probe.ts <httpBaseUrl> <bearerToken>
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";

import { bearerRegistration, fetchDescriptor } from "./connect/localServer.ts";
import { appAtomRegistry } from "./runtime/runtime.ts";
import { environmentCatalog, environmentShell } from "./state/environment.ts";

const [httpBaseUrl, token] = process.argv.slice(2);
if (!httpBaseUrl || !token) throw new Error("usage: probe <httpBaseUrl> <token>");

const descriptor = await fetchDescriptor(httpBaseUrl);
console.log("descriptor", descriptor);

const unmountCatalog = appAtomRegistry.mount(environmentCatalog.catalogAtom);
const result = await runAtomCommand(
  appAtomRegistry,
  environmentCatalog.register,
  bearerRegistration({ descriptor, httpBaseUrl, token }),
);
console.log("register", result._tag);

const shellAtom = environmentShell.stateValueAtom(descriptor.environmentId);
const done = Promise.withResolvers<void>();
const unmount = appAtomRegistry.subscribe(
  shellAtom,
  (state) => {
    console.log("shell status", state.status, Option.isSome(state.error) ? state.error.value : "");
    if (Option.isSome(state.snapshot)) {
      const snap = state.snapshot.value;
      for (const p of snap.projects) console.log("project", p.title ?? p.id, p.workspaceRoot);
      for (const t of snap.threads.slice(0, 10)) console.log("thread", t.title);
      done.resolve();
    }
  },
  { immediate: true },
);
const conn = appAtomRegistry.subscribe(
  environmentCatalog.stateAtom(descriptor.environmentId),
  (s) => console.log("connection", JSON.stringify(s).slice(0, 200)),
  { immediate: true },
);
await Promise.race([done.promise, Bun.sleep(20000)]);
unmount();
conn();
unmountCatalog();
process.exit(0);
