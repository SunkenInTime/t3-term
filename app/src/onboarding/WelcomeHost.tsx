// apps/web/src/routes/welcome.tsx: while setup is open (welcomeRouteAtom, web's
// /welcome) the wizard sits over home. On done it opens a new thread in the
// project setup landed on, or goes home when none was chosen.
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { startNewThread } from "../palette/actions.ts";
import { appAtomRegistry } from "../runtime/runtime.ts";
import { closeWelcome, welcomeRouteAtom } from "../state/onboarding.ts";
import { routeAtom } from "../state/ui.ts";
import { WelcomeWizard } from "./WelcomeWizard.tsx";

export function WelcomeHost() {
  const welcomeRoute = useAtomValue(welcomeRouteAtom);
  // One wizard per visit: a reopened setup starts from its first step again.
  const [visit, setVisit] = useState(0);
  if (welcomeRoute === null) return null;
  return (
    <WelcomeWizard
      key={visit}
      resumeEnvironmentId={welcomeRoute.resumeEnvironmentId}
      onDone={async (projectRef) => {
        closeWelcome();
        setVisit((value) => value + 1);
        if (projectRef !== undefined) {
          try {
            startNewThread(projectRef);
            return;
          } catch {}
        }
        appAtomRegistry.set(routeAtom, { kind: "home" });
      }}
    />
  );
}
