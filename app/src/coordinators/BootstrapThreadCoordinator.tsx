// apps/web/src/routes/__root.tsx EventRouter handleWelcome: when the server
// welcome names a bootstrap thread (a server started with `t3 <dir>` seeds
// one), open it while the user is still on home, and expand its project in
// the legacy sidebar. Each bootstrap thread is opened once per session, so
// leaving it and returning home does not pull the user back.
import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useEffect, useRef } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { clientSettingsAtom } from "../state/clientSettings.ts";
import { primaryServerConfigAtom } from "../state/coordinators.ts";
import { environmentProjects } from "../state/environment.ts";
import { setLegacyProjectExpanded } from "../state/legacySidebar.ts";
import { primaryServerWelcomeAtom, returningFromWelcomeAtom, welcomeRouteAtom } from "../state/onboarding.ts";
import { routeAtom } from "../state/ui.ts";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKeyFromPath,
  selectProjectGroupingSettings,
} from "../web/logicalProject.ts";

export function BootstrapThreadCoordinator() {
  const welcome = useAtomValue(primaryServerWelcomeAtom);
  // Web mounts EventRouter only outside /welcome; setup open means no router here.
  const welcomeOpen = useAtomValue(welcomeRouteAtom) !== null;
  const handledThreadIdRef = useRef<string | null>(null);
  // web skipInitialBootstrapNavigation: when setup has run this session, it already
  // chose where to land, so the first welcome after it only marks its thread handled.
  // Web remounts EventRouter after /welcome; this stays mounted, so it skips once.
  const skippedAfterWelcomeRef = useRef(false);

  useEffect(() => {
    if (welcomeOpen) return;
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
    if (appAtomRegistry.get(returningFromWelcomeAtom) && !skippedAfterWelcomeRef.current) {
      skippedAfterWelcomeRef.current = true;
      handledThreadIdRef.current = welcome.bootstrapThreadId;
      return;
    }
    if (handledThreadIdRef.current === welcome.bootstrapThreadId) return;
    handledThreadIdRef.current = welcome.bootstrapThreadId;
    appAtomRegistry.set(routeAtom, { kind: "thread", environmentId, threadId: welcome.bootstrapThreadId });
  }, [welcome, welcomeOpen]);

  return null;
}
