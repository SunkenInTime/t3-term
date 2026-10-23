# t3-term

T3 Code (https://github.com/pingdotgg/t3code) rebuilt as a GPUI app with
[gpuix](https://github.com/remorses/gpuix), so it runs **inside a terminal**
(kitty graphics protocol: kitty, Ghostty on macOS/Linux) or as a native window.
The goal is a one-to-one match with the T3 Code web/desktop client, visually
and functionally.

t3-term is a **client**, like T3's web and mobile apps. It talks to a T3 server
(`npx t3`, the desktop app's server, or a dev server) over T3's WebSocket RPC,
using T3's own `packages/client-runtime` for connection, state and commands.
Provider runs, git, terminals and persistence all happen on the server.

## Layout

```
vendor/t3code/          git submodule, pinned. Read-only. Never edit.
app/                    the client (Bun + @gpuix/react)
  src/main.tsx          entry: CLI args, connection bootstrap, render()
  src/runtime/          Effect layers: platform services, connection runtime
  src/state/            atoms. environment.ts = client-runtime atom families (shared)
  src/ui/               design system: theme tokens, Icon, primitives, overlay kit, toasts
  src/app/              App providers, MainView route switch, MainHeader
  src/sidebar/          thread sidebar
  src/chat/             ChatView composition, timeline/, composer/, header/, details/, DraftView
  src/panels/           right panel surfaces (diff, files, PR, terminal tab)
  src/terminal/         terminal drawer + VT emulator view
  src/settings/         settings pages + settings sidebar nav
  src/palette/          command palette
  src/dialogs/          app-level dialogs
  src/keybindings/      global shortcut dispatch
  src/web/              logic ported from apps/web/src (same relative paths)
docs/                   specs: web-ui-spec.md, client-runtime.md, gpuix-notes.md
```

## How to port a web component

1. Read the web component in `vendor/t3code/apps/web/src/...` and every
   `*.logic.ts`, store and hook it uses.
2. Pure logic (no DOM, no React DOM, no Tailwind): copy it into `app/src/web/`
   at the same relative path, fix imports, keep the code as close to the
   original as possible so later submodule bumps can be diffed. Note the
   source path in a header comment.
3. Views: rewrite with gpuix elements (`div`, `text`, `svg`, `textarea`,
   `markdown`, `code`, `diff`, `virtual-list`, `anchored`). Translate Tailwind
   classes to explicit px and colors using `docs/web-ui-spec.md` and
   `app/src/ui/theme.ts`. Reuse `app/src/ui/*`.
4. State and commands: use client-runtime atom factories and
   `runAtomCommand(appAtomRegistry, command, input)`. Mirror how
   `vendor/t3code/apps/web/src/state/*` and `apps/mobile/src/state/*` wire them.
   Never call raw RPC clients from views.

## Rules

- **Ownership.** Each area directory belongs to one agent at a time. Do not edit
  another area's files. Shared files (`ui/theme.ts`, `ui/primitives.tsx`,
  `ui/overlay.tsx`, `state/environment.ts`, `state/ui.ts`, `app/*`) take small
  additive changes only, and say so in your report. New atom families go in
  `state/<area>.ts`.
- **gpuix gotchas** (details in `docs/gpuix-notes.md`): every `<text>` needs a
  color; `div` is not flex by default; no nested vertical scrollers; overlays
  must use `<anchored deferred>` / the `ui/overlay.tsx` kit, never
  `position: absolute` over a list; no z-index; no CSS transitions (use
  `motion.div` sparingly, never continuously repainting); hover-reveal needs
  `onMouseEnter`/`onMouseLeave` state; a filled child of a click target needs
  `pointerEvents: "none"`; Enter/arrows inside a `<textarea>` are not seen by
  `onKeyDown`.
- **No continuous animations.** T3's rule: no repainting spinners or shimmers.
- **Comments say why**, not what. Match the surrounding code style.

## Safety (read this)

- `T3CODE_HOME` in agent shells points at Dara's **live** T3 install (`E:\.t3`).
  Never start a T3 server or CLI command without overriding it
  (`T3CODE_HOME='E:\w\ref\t3home-dev'`). Never touch the live server on :3773.
- Never kill processes by name or pattern. Stop only PIDs you started.
- Provider runs started from t3-term are real agent runs. Only send messages
  in threads of the **t3term-sandbox** project (`E:\w\t3term-sandbox`), with
  short harmless prompts. Never send in seeded threads: their projects are
  real repositories.

## Dev loop

Reference T3 server (dev build of the pinned commit) on a seeded scratch home:
`http://127.0.0.1:13773`, web UI at `http://localhost:5733`. It is already
running; do not restart it. A bearer token is in `E:\w\ref\t3term-dev-token.txt`.

```bash
cd app
bun install                                   # once per worktree (run at repo root)
bun node_modules/typescript/bin/tsc --noEmit -p .   # typecheck

# run (native window)
T3TERM_HOME='E:\w\t3term-home-<you>' bun src/main.tsx --url http://127.0.0.1:13773 --token "$(cat E:/w/ref/t3term-dev-token.txt)"

# screenshot loop (hidden window, gpuix automation)
T3TERM_HOME='E:\w\t3term-home-<you>' T3TERM_ARGS="--url http://127.0.0.1:13773 --token $(cat E:/w/ref/t3term-dev-token.txt)" \
  bun scripts/shot.ts 'E:\w\t3term-shots\<you>' steps.json
```

`scripts/shot.ts` steps: `{wait}`, `{click: testId}`, `{clickText}`,
`{mouse: [x, y]}`, `{fill: [testId, text]}`, `{press: "ctrl-k", target?: testId}`,
`{shot: name}`. Give interactive elements a `testId`.

Reference screenshots of the real web UI: `E:\w\refshots\out\*.png`
(1440×900, dark). Make more with `node E:\w\refshots\tools\shoot2.mjs steps.json`
(playwright against :5733; steps `{goto}`, `{click: selector}`,
`{mouse: [x,y]}`, `{press}`, `{type}`, `{wait}`, `{shot}`, `{scroll: [x,y,dy]}`).
Pass Windows paths (`'E:\w\...'`) to Node from Git Bash; a `/e/w/...` path is
not translated and lands in `E:\e\w\...`.

Done means: typecheck clean, and you compared your screenshots against the
web reference for every state you built, at 1440×900.

## Terminal-mode verification

gpuix's kitty renderer runs on macOS and Linux only. Windows development uses
the native window, which renders the same React tree. To check terminal mode:

- **Headless:** `python3 app/scripts/fake-kitty.py <out-dir> <steps.json> -- bun src/main.tsx --terminal ...`
  on a Linux/macOS box. It answers the terminal queries, forces inline frames
  (the SSH path), writes PNGs, and injects SGR pixel mouse and kitty keys.
- **Real terminal:** a boat VM (`boat new`), `sudo apt-get install kitty
  imagemagick xdotool mesa-vulkan-drivers`, run t3-term in `kitty` on `DISPLAY=:0`,
  drive it with `xdotool`, capture with `import -window root`. To reach the
  reference server from the VM: `boat forward <id> --reverse --local 13773`.
