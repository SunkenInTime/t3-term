#!/usr/bin/env bun
// t3-term: T3 Code as a GPUI app that runs in a kitty-graphics terminal
// (`--terminal`, macOS/Linux) or a native window.
//
//   t3-term --url http://127.0.0.1:3773 --token <bearer>    connect with a session token
//   t3-term --url http://host:3773 --pair <code>             pair with a one-time code
//   t3-term --pair 'http://host:3773/pair#token=CODE'        pair with a pairing URL
//   t3-term                                                   the T3 server on this machine, plus saved environments
//   t3-term --no-local                                        saved environments only
import { render } from "@gpuix/react";

import { App } from "./app/App.tsx";
import { bootstrapConnections, parseArgs } from "./connect/bootstrap.ts";
import { installPerfProbe, perfOnEvent, perfProbeEnabled } from "./dev/perfProbe.ts";
import { handleGlobalKeyDown, handleGlobalKeyUp } from "./keybindings/useGlobalKeybindings.ts";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    "usage: t3-term [--url <http-url> (--token <bearer> | --pair <code>)] [--pair <pairing-url>] [--no-local] [--terminal | --window]",
  );
  process.exit(0);
}

const boot = await bootstrapConnections(args);

const background = process.env.GPUIX_BACKGROUND === "1";
render(<App boot={boot} />, {
  title: "T3 Code",
  width: 1440,
  height: 900,
  terminal: args.terminal,
  focus: !background,
  keyboardFocusDim: false,
  // T3TERM_DEBUG_FRAMES=minimal|full paints GPUI draw times into the window.
  ...(process.env.T3TERM_DEBUG_FRAMES ? { debugFrameOverlay: process.env.T3TERM_DEBUG_FRAMES as "minimal" | "full" } : {}),
  ...(perfProbeEnabled ? { onEvent: perfOnEvent } : {}),
  onKeyDown: (event) => handleGlobalKeyDown(event),
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
