// Port of apps/web/src/components/onboarding/FirstRunGate.tsx: decides whether
// this workspace still needs first-run setup once settings are read and every
// environment's shell has arrived. Nothing renders while that is pending: no
// shell, and no BootstrapThreadCoordinator, whose welcome payload would otherwise
// open the bootstrap thread over setup. After 4 s pending it offers a retry
// ("Still connecting"); an unreadable settings file gets its own recovery.
//
// Web's /welcome route is welcomeRouteAtom here (state/onboarding.ts); setup opens
// by itself only from home, as web's opens only from "/".
import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import {
  clientSettingsHydrationStatusAtom,
  ensureClientSettingsHydrated,
  useClientSettings,
} from "../state/clientSettings.ts";
import { primaryServerConfigAtom } from "../state/coordinators.ts";
import { environmentCatalog, environmentProjects } from "../state/environment.ts";
import {
  allEnvironmentShellsBootstrappedAtom,
  openWelcome,
  primaryServerWelcomeAtom,
  primaryShellLiveAtom,
  soleThreadAtom,
  threadCountAtom,
  welcomeRouteAtom,
  workspaceEvidenceLiveAtom,
} from "../state/onboarding.ts";
import { routeAtom } from "../state/ui.ts";
import { Icon } from "../ui/Icon.tsx";
import { Button, Text } from "../ui/primitives.tsx";
import { useTheme } from "../ui/theme.ts";
import { completeOnboarding } from "../web/onboarding/firstRun.ts";
import {
  isFirstRunWorkspaceProvenanceAuthoritative,
  isFreshFirstRunWorkspace,
  resolveFirstRunDecision,
  transitionFirstRunGateState,
  type FirstRunGateState,
} from "../web/onboarding/firstRun.logic.ts";

const FIRST_RUN_DECISION_TIMEOUT_MS = 4_000;

export function FirstRunGate({ children }: { readonly children: ReactNode }) {
  const hydrationStatus = useAtomValue(clientSettingsHydrationStatusAtom);
  const hydrated = hydrationStatus === "ready";
  const onboardingCompletedAt = useClientSettings((settings) => settings.onboardingCompletedAt);
  const bootstrapped = useAtomValue(allEnvironmentShellsBootstrappedAtom);
  const environmentCatalogReady = useAtomValue(environmentCatalog.catalogValueAtom).isReady;
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const threadCount = useAtomValue(threadCountAtom);
  const soleThread = useAtomValue(soleThreadAtom);
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const serverWelcome = useAtomValue(primaryServerWelcomeAtom);
  const primaryShellLive = useAtomValue(primaryShellLiveAtom);
  const workspaceEvidenceLive = useAtomValue(workspaceEvidenceLiveAtom);
  const route = useAtomValue(routeAtom);
  const welcomeRoute = useAtomValue(welcomeRouteAtom);
  // t3-term's gate only mounts behind ConnectGate, so an environment is always
  // registered: web's `enabled` (an authenticated primary environment) holds.
  const enabled = true;
  const [gateState, setGateState] = useState<FirstRunGateState>(() => ({
    decision: hydrated && onboardingCompletedAt !== null ? "app" : "pending",
    stalled: false,
  }));
  const [attempt, setAttempt] = useState(0);
  const { decision, stalled } = gateState;
  const settingsReadFailed = hydrationStatus === "failed" || hydrationStatus === "retrying";
  // A workspace still counts as fresh when its only content is the server's own
  // cwd auto-bootstrap: a server started in a folder creates a project + thread
  // from it, so "no projects at all" would mean those users never see setup.
  const serverCwd = serverConfig?.cwd ?? null;
  const primaryEnvironmentId = serverConfig?.environment.environmentId ?? null;
  const workspaceFresh =
    threadCount <= 1 &&
    isFreshFirstRunWorkspace({
      primaryEnvironmentId,
      serverCwd,
      bootstrapProjectId: serverWelcome?.bootstrapProjectId,
      bootstrapThreadId: serverWelcome?.bootstrapThreadId,
      bootstrapProjectCreated: serverWelcome?.bootstrapProjectCreated,
      bootstrapThreadCreated: serverWelcome?.bootstrapThreadCreated,
      projects,
      threads: soleThread === null ? [] : [soleThread],
    });

  const { decision: nextDecision, persistCompletion } = resolveFirstRunDecision({
    enabled,
    hydrated,
    completed: onboardingCompletedAt !== null,
    bootstrapped,
    authoritative: primaryShellLive,
    workspaceAuthoritative: workspaceEvidenceLive,
    workspaceProvenanceAuthoritative: isFirstRunWorkspaceProvenanceAuthoritative({
      welcomeReceived: serverWelcome !== null,
      bootstrapStatus: serverWelcome?.bootstrapStatus ?? null,
    }),
    catalogReady: environmentCatalogReady,
    serverConfigAvailable: serverConfig !== null,
    workspaceFresh,
    projectCount: projects.length,
    threadCount,
  });

  if (hydrated) {
    const transitioned = transitionFirstRunGateState(gateState, { type: "evidence", decision: nextDecision });
    if (transitioned !== gateState) setGateState(transitioned);
  }

  useEffect(() => {
    if (decision === "wizard" || !hydrated) return;
    if (persistCompletion && onboardingCompletedAt === null) {
      void completeOnboarding().catch(() => undefined);
    }
  }, [decision, hydrated, onboardingCompletedAt, persistCompletion]);

  useEffect(() => {
    if (decision !== "pending" || !hydrated) return;
    const timer = setTimeout(
      () => setGateState((state) => transitionFirstRunGateState(state, { type: "timeout" })),
      FIRST_RUN_DECISION_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [decision, hydrated, attempt]);

  // Setup opens by itself only from home. Anywhere else (Settings, a thread)
  // opens as asked, so setup can never lock a user out of the app.
  const wizardOwnsRoute = route.kind === "home";
  useEffect(() => {
    if (decision === "wizard" && wizardOwnsRoute && appAtomRegistry.get(welcomeRouteAtom) === null) {
      openWelcome();
    }
  }, [decision, wizardOwnsRoute]);

  if (settingsReadFailed) {
    return <FirstRunRecovery reason="settings" retrying={hydrationStatus === "retrying"} />;
  }
  // Web renders /welcome outside the gate; setup is open, so the app shell shows behind it.
  if (welcomeRoute !== null) return children;
  if (decision === "wizard" && !wizardOwnsRoute) return children;
  if (decision !== "app") {
    return stalled ? (
      <FirstRunRecovery
        reason="connection"
        onReload={() => {
          // Web reloads the page; here every environment retries now and the gate waits again.
          for (const environmentId of appAtomRegistry.get(environmentCatalog.catalogValueAtom).entries.keys()) {
            void runAtomCommand(appAtomRegistry, environmentCatalog.retryNow, environmentId);
          }
          setGateState({ decision: "pending", stalled: false });
          setAttempt((value) => value + 1);
        }}
      />
    ) : (
      // Web's empty page shows the body's background; gpuix's window has none of its own.
      <PendingBackground />
    );
  }
  return children;
}

function PendingBackground() {
  const theme = useTheme();
  return <div style={{ width: "100%", height: "100%", backgroundColor: theme.background }} />;
}

function FirstRunRecovery({
  reason,
  retrying = false,
  onReload,
}: {
  readonly reason: "settings" | "connection";
  readonly retrying?: boolean;
  readonly onReload?: () => void;
}) {
  const theme = useTheme();
  const settingsReadFailed = reason === "settings";
  return (
    <div
      testId={`first-run-recovery-${reason}`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        paddingLeft: 24,
        paddingRight: 24,
        backgroundColor: theme.background,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 384 }}>
        <Text size="lg" weight={600} style={{ textAlign: "center" }}>
          {settingsReadFailed ? "Could not read settings" : "Still connecting"}
        </Text>
        <Text color={theme.mutedForeground} style={{ marginTop: 8, textAlign: "center" }}>
          {settingsReadFailed ? "Your saved settings could not be loaded." : "T3 Code could not confirm this workspace."}
        </Text>
        <Button
          testId={`first-run-recovery-${settingsReadFailed ? "retry" : "reload"}`}
          size="sm"
          variant="outline"
          disabled={retrying}
          leading={<Icon name="refresh-cw" size={16} color={theme.mutedForeground} />}
          style={{ marginTop: 20 }}
          onClick={() => {
            if (settingsReadFailed) void ensureClientSettingsHydrated().catch(() => undefined);
            else onReload?.();
          }}
        >
          {settingsReadFailed ? "Retry" : "Reload"}
        </Button>
      </div>
    </div>
  );
}
