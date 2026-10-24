// apps/web/src/routes/__root.tsx RootRouteErrorView: when rendering throws,
// web's root route swaps the app for an error report with Try again, Reload
// app and Copy error. t3-term has no router, so a React error boundary around
// the app shell does the same.
//
// Try again clears the boundary and renders the shell again (web
// router.invalidate()). Reload app asks App to remount its whole tree under a
// new key (web window.location.reload()): t3-term has one renderer and one
// window, so restarting the process would lose the window, while a remount
// rebuilds every component. Atoms in the app registry (connection, route,
// settings) survive it, the way the URL and server state survive a web reload.
import { useAtomValue } from "@effect/atom-react";
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";

import { copyTextToClipboard } from "../chat/header/osActions.ts";
import { StandalonePage, StandalonePageHeader } from "../connect/StandalonePage.tsx";
import { APP_VERSION } from "../runtime/platform.ts";
import { routeAtom, type Route } from "../state/ui.ts";
import { Icon } from "../ui/Icon.tsx";
import { Button, Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";

const APP_DISPLAY_NAME = "T3 Code";

interface BoundaryState {
  readonly error: unknown;
  readonly failed: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode; onReload: () => void }, BoundaryState> {
  override state: BoundaryState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error, failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("t3-term render error", error, info.componentStack);
    devCrashCaught();
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <AppErrorView
        error={this.state.error}
        onRetry={() => this.setState({ error: null, failed: false })}
        onReload={this.props.onReload}
      />
    );
  }
}

function AppErrorView({ error, onRetry, onReload }: { error: unknown; onRetry: () => void; onReload: () => void }) {
  const theme = useTheme();
  const route = useAtomValue(routeAtom);
  // Taken once, like web's report on the error screen: the time is when it broke.
  const [report] = useState(() => errorReport(error, routePath(route)));
  return (
    <StandalonePage>
      <StandalonePageHeader eyebrow={APP_DISPLAY_NAME} title="Something went wrong." description={errorMessage(error)} />
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
        <Button size="sm" testId="error-try-again" onClick={onRetry}>
          Try again
        </Button>
        <Button size="sm" variant="outline" testId="error-reload" onClick={onReload}>
          Reload app
        </Button>
        <CopyErrorButton report={report} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: 20,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.7),
          backgroundColor: alpha(theme.background, 0.55),
          overflow: "hidden",
        }}
      >
        <Text size="xs" weight={500} color={theme.mutedForeground} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6 }}>
          Error report
        </Text>
        {/* web <pre class="max-h-64 overflow-auto">: gpuix has no `pre`, so each line is its own run. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxHeight: 256,
            overflowY: "scroll",
            borderTopWidth: 1,
            borderColor: alpha(theme.border, 0.7),
            backgroundColor: alpha(theme.background, 0.8),
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
          }}
        >
          {report.split("\n").map((line, index) => (
            <text
              key={index}
              style={{ fontFamily: FONTS.mono, fontSize: 12, lineHeight: 16, color: alpha(theme.foreground, 0.85), userSelect: "text", minHeight: 16, flexShrink: 0 }}
            >
              {line}
            </text>
          ))}
        </div>
      </div>
    </StandalonePage>
  );
}

function CopyErrorButton({ report }: { report: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <Button
      size="sm"
      variant="outline"
      testId="error-copy"
      leading={<Icon name={copied ? "check" : "copy"} size={16} color={copied ? theme.successForeground : theme.foreground} />}
      onClick={() => {
        // gpuix has no JS clipboard API; t3-term shells out (OSC 52 in a terminal).
        void copyTextToClipboard(report).then(
          () => {
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
          },
          () => undefined,
        );
      }}
    >
      {copied ? "Copied" : "Copy error"}
    </Button>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return "An unexpected error occurred.";
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "No additional error details are available.";
  }
}

const MAX_ERROR_CAUSE_DEPTH = 5;

/** web errorReport. The path stands in for web's pathname; it never carries the session token. */
function errorReport(error: unknown, path: string): string {
  const lines = [`${APP_DISPLAY_NAME} ${APP_VERSION} (t3-term)`, `Path: ${path}`, `Time: ${new Date().toISOString()}`, "", errorDetails(error)];
  let cause = error instanceof Error ? error.cause : undefined;
  for (let depth = 0; cause !== undefined && depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    lines.push("", "Caused by:", errorDetails(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return lines.join("\n");
}

/** The web route path for the current view, for the report. */
function routePath(route: Route): string {
  switch (route.kind) {
    case "thread":
      return `/${route.environmentId}/${route.threadId}`;
    case "draft":
      return route.environmentId && route.projectId ? `/${route.environmentId}/new?project=${route.projectId}` : "/new";
    case "settings":
      return `/settings/${route.page}`;
    case "pull-requests":
      return "/pull-requests";
    case "usage":
      return "/usage";
    case "prompt-link":
      return "/new";
    default:
      return "/";
  }
}

// ── Dev-only crash switch ───────────────────────────────────────────────
// T3TERM_DEV_CRASH=once throws from a component inside the boundary until the
// boundary has caught it once, so Try again recovers; =always keeps throwing,
// so Try again lands back on the report. Unset, DevCrash renders nothing.
// React retries a failed render before giving up, so "once" stays armed until
// the catch rather than counting renders.

const devCrashMode = process.env.T3TERM_DEV_CRASH?.trim();
let devCrashArmed = devCrashMode === "once" || devCrashMode === "always";

function devCrashCaught(): void {
  if (devCrashMode === "once") devCrashArmed = false;
}

export function DevCrash(): null {
  if (devCrashArmed) {
    throw new Error("T3TERM_DEV_CRASH: deliberate render error", { cause: new Error(`mode=${devCrashMode}`) });
  }
  return null;
}
