// apps/web/src/routes/__root.tsx EventRouter handleWelcome: when the server
// welcome names a bootstrap thread (a server started with `t3 <dir>` seeds
// one), open it while the user is still on home, and expand its project in
// the legacy sidebar. Each bootstrap thread is opened once per session, so
// leaving it and returning home does not pull the user back.
import { useAtomValue } from "@effect/atom-react";
import type { ServerLifecycleWelcomePayload } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { useEffect, useRef } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { clientSettingsAtom } from "../state/clientSettings.ts";
import { primaryServerConfigAtom } from "../state/coordinators.ts";
import { environmentProjects, serverEnvironment } from "../state/environment.ts";
import { setLegacyProjectExpanded } from "../state/legacySidebar.ts";
import { primaryEnvironmentIdAtom } from "../state/settings.ts";
import { routeAtom } from "../state/ui.ts";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKeyFromPath,
  selectProjectGroupingSettings,
} from "../web/logicalProject.ts";

const primaryServerWelcomeAtom = Atom.make((get): ServerLifecycleWelcomePayload | null => {
  const environmentId = get(primaryEnvironmentIdAtom);
  if (environmentId === null) return null;
  return Option.getOrNull(AsyncResult.value(get(serverEnvironment.welcome({ environmentId, input: {} }))));
}).pipe(Atom.withLabel("t3term-primary-server-welcome"));

export function BootstrapThreadCoordinator() {
  const welcome = useAtomValue(primaryServerWelcomeAtom);
  const handledThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!welcome?.bootstrapProjectId || !welcome.bootstrapThreadId) return;
    const environmentId = welcome.environment.environmentId;
    const projectRef = scopeProjectRef(environmentId, welcome.bootstrapProjectId);
    const project = appAtomRegistry
      .get(environmentProjects.projectsAtom)
      .find((candidate) => candidate.environmentId === environmentId && candidate.id === welcome.bootstrapProjectId);
    const serverCwd = appAtomRegistry.get(primaryServerConfigAtom)?.cwd;
    const projectKey =
      (project
        ? deriveLogicalProjectKeyFromSettings(project, selectProjectGroupingSettings(appAtomRegistry.get(clientSettingsAtom)))
        : null) ??
      (serverCwd ? derivePhysicalProjectKeyFromPath(environmentId, serverCwd) : null) ??
      scopedProjectKey(projectRef);
    setLegacyProjectExpanded([projectKey], true);

    if (appAtomRegistry.get(routeAtom).kind !== "home") return;
    if (handledThreadIdRef.current === welcome.bootstrapThreadId) return;
    handledThreadIdRef.current = welcome.bootstrapThreadId;
    appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId: welcome.bootstrapThreadId });
  }, [welcome]);

  return null;
}
