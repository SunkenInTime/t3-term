#!/usr/bin/env bun
// t3-term: T3 Code as a GPUI app that runs in a kitty-graphics terminal
// (`--terminal`, macOS/Linux) or a native window.
//
//   t3-term --url http://127.0.0.1:3773 --token <bearer>    connect with a session token
//   t3-term --url http://host:3773 --pair <code>             pair with a one-time code
//   t3-term --pair 'http://host:3773/pair#token=CODE'        pair with a pairing URL
//   t3-term                                                   the T3 server on this machine, plus saved environments
//   t3-term --no-local                                        saved environments only
//   t3-term --open 'https://app.t3.codes/new?prompt=...'     open a T3 Code prompt link (also t3code://..., /new?...)
//   t3-term <folder>                                          open a new thread in that folder's project
// With --open or a folder and no connection arguments, a t3-term already running
// for this T3TERM_HOME takes the request and this one exits (activation/activation.ts).
import { isTerminal, render } from "@gpuix/react";

import { activationRequestFromArgs, forwardToRunningInstance, handleActivationRequest, startActivationServer } from "./activation/activation.ts";
import { App } from "./app/App.tsx";
import { handleMarkdownCopy } from "./chat/markdown/copy.ts";
import { bootstrapConnections, parseArgs } from "./connect/bootstrap.ts";
import { installPerfProbe, perfOnEvent, perfProbeEnabled } from "./dev/perfProbe.ts";
import { handleGlobalKeyDown, handleGlobalKeyUp } from "./keybindings/useGlobalKeybindings.ts";
import { noteUserInput } from "./notifications/platform.ts";
import { noteWindowInput } from "./runtime/windowActivity.ts";
import { startClientTracing } from "./runtime/clientTracingTarget.ts";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    "usage: t3-term [--url <http-url> (--token <bearer> | --pair <code>)] [--pair <pairing-url>] [--no-local] [--terminal | --window] [--open <t3 code link> | <folder>]",
  );
  process.exit(0);
}

const activation = activationRequestFromArgs(args);
if (activation !== null && args.url === undefined && args.pair === undefined) {
  const forwarded = await forwardToRunningInstance(activation);
  if (forwarded !== null) {
    if (!forwarded.ok) console.error(forwarded.message);
    process.exit(forwarded.ok ? 0 : 1);
  }
}
const boot = await bootstrapConnections(args);
startActivationServer();
if (activation !== null) void handleActivationRequest(activation);

const background = process.env.GPUIX_BACKGROUND === "1";
// T3TERM_WINDOW=<width>x<height> opens the window at another size (screenshots of narrow layouts).
const windowSize = /^(\d+)x(\d+)$/.exec(process.env.T3TERM_WINDOW?.trim() ?? "");
render(<App boot={boot} />, {
  title: "T3 Code",
  width: windowSize ? Number(windowSize[1]) : 1440,
  height: windowSize ? Number(windowSize[2]) : 900,
  terminal: args.terminal,
  focus: !background,
  keyboardFocusDim: false,
  // T3TERM_DEBUG_FRAMES=minimal|full paints GPUI draw times into the window.
  ...(process.env.T3TERM_DEBUG_FRAMES ? { debugFrameOverlay: process.env.T3TERM_DEBUG_FRAMES as "minimal" | "full" } : {}),
  onKeyDown: (event, renderer) => {
    noteWindowInput("key");
    // Copying chat markdown joins its runs back into lines (chat/markdown/copy.ts).
    if (handleMarkdownCopy(event)) return;
    handleGlobalKeyDown(event, renderer);
  },
  onEvent: (event) => {
    if (perfProbeEnabled) perfOnEvent(event);
    // Every pointer, wheel and key event marks the user present; gpuix has no window-focus state.
    const eventType = String(event.eventType ?? "");
    if (!/layout|scrollchange|visiblerange|motion/i.test(eventType)) {
      noteUserInput();
      // Background activity reports (web/lib/backgroundActivityReporter.ts) count this as interaction.
      noteWindowInput(/^key/i.test(eventType) ? "key" : "pointer");
    }
  },
  onKeyUp: (event) => handleGlobalKeyUp(event),
  titlebarTransparent: process.platform === "darwin",
  // GPUI on Windows draws text with ClearType-style subpixel AA (coloured fringes)
  // in an opaque window and grayscale AA in a transparent one; web is grayscale.
  // The app paints every pixel with its own background, so nothing shows through.
  ...(process.platform === "win32" && !args.terminal ? { windowBackground: "transparent" as const } : {}),
  trafficLightX: 16,
  trafficLightY: 18,
});
installPerfProbe();
// Client traces go to the command line's environment, as web sends them to its primary one.
startClientTracing({ preferredEnvironmentId: boot.environmentId, mode: isTerminal() ? "terminal" : "window" });
