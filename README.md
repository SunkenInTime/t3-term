<img src="assets/icon.svg" width="64" height="64" alt="">

# t3-term

[T3 Code](https://t3.codes) in your terminal. The full T3 Code client (sidebar,
chat, composer, model picker, approvals, git actions, diffs, integrated
terminal, browser preview, settings, command palette) drawn on the GPU with
[GPUIX](https://github.com/remorses/gpuix) and shown inside the terminal through
the kitty graphics protocol. It also runs as a native window.

t3-term is a client. It connects to a T3 Code server the same way the web,
desktop and mobile apps do, so your providers, projects, threads and settings
are the ones you already have.

## Requirements

- [Bun](https://bun.sh) 1.4 or newer.
- For terminal mode: [kitty](https://sw.kovidgoyal.net/kitty/) or
  [Ghostty](https://ghostty.org) on macOS (Apple silicon) or Linux (x64).
  Windows has no kitty-graphics terminal, so t3-term opens a native window there.
- A running T3 Code server: the desktop app, `npx t3`, or `npx t3 serve`.

## Run

```bash
git clone --recurse-submodules https://github.com/SunkenInTime/t3-term
cd t3-term
bun install
cd app

bun src/main.tsx --terminal        # inside kitty or Ghostty
bun src/main.tsx                   # native window
```

With no arguments t3-term finds the T3 server running on this machine (from
`$T3CODE_HOME`, default `~/.t3`) and signs in through its `t3` CLI, like
`t3 pair` does. Saved connections reconnect on the next start.

Other servers:

```bash
bun src/main.tsx --pair 'http://host:3773/pair#token=ABCD1234'   # a pairing link
bun src/main.tsx --url http://host:3773 --pair ABCD1234          # host and code
bun src/main.tsx --url http://host:3773 --token <bearer>          # a session token
```

It works over SSH too. When the terminal can't read shared memory, t3-term sends
each frame inline. `ssh -t host 'cd t3-term/app && bun src/main.tsx --terminal'`.

## Build a single binary

```bash
cd app
bun run build          # writes dist/t3-term (dist/t3-term.exe on Windows)
```

The binary carries the GPUIX renderer, so it needs no Bun or Node install.

## Keys

The same shortcuts as T3 Code (`Ctrl` is `Cmd` on macOS): `Ctrl+K` command
palette, `Ctrl+N` new thread, `Ctrl+B` sidebar, `Ctrl+J` terminal, `Ctrl+P` go
to file, `Ctrl+Shift+M` model picker, and the rest from Settings → Keybindings.
In terminal mode `Ctrl+C` quits t3-term; kitty and Ghostty may claim some
`Ctrl+Shift` shortcuts for themselves.

## What's different from T3 Code

- Device mirroring decodes the H.264 stream with ffmpeg, so `ffmpeg` has to be
  on `PATH` (or named by `T3TERM_FFMPEG`). Only the flat device view exists:
  T3 Code's 3D phone needs WebGL. iOS simulators without ffmpeg fall back to
  MJPEG, as in a browser without WebCodecs.
- GPUI has no background blur, so menus, dialogs and the composer are solid
  instead of glassy. Links inside agent messages use the body text colour.
- HTML renders and MCP apps show as a card, because there is no web view.

## Development

`AGENTS.md` covers the layout, how web components are ported, the safety rules
and the screenshot loop. T3 Code's source is pinned as a submodule in
`vendor/t3code`; t3-term reuses its `client-runtime`, `contracts` and `shared`
packages directly.
