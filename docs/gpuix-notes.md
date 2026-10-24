# gpuix notes for t3-term

gpuix 0.11.0 (`@gpuix/react`, `@gpuix/native`), pinned exactly. Source reference:
`E:\w\ref\gpuix` (README.md is the API contract; `examples/chat.tsx` is a large
real app). Paths below are relative to that checkout.

## Elements

| Element | Props beyond style/events |
|---|---|
| `div` | Block by default; set `display: "flex"` before flex props |
| `text` | Must have `color` (or a parent div's color). Adjacent `<text>` siblings merge into one line. No nested `<text>` |
| `input` | `value`, `placeholder`, `readOnly`, `theme` (caret), `onChange(e.value)`, `onSubmit` (Enter) |
| `textarea` | as input + `minRows`, `maxRows`; with `onSubmit`, Enter submits and Shift+Enter inserts a newline |
| `virtual-list` | `alignment: "top"|"bottom"`, `followTail`, `overdraw` (512), `estimatedItemHeight`, `itemCount` + `windowStart` (windowed mode), `onVisibleRange`. No testId (wrap in a div), no hover |
| `markdown` | `source`, `theme`, `onLinkClick`. GFM: tables, task lists, strikethrough, autolinks, fenced code |
| `code` | `code`, `language` or `path`, `showLineNumbers`, `theme`. Never wraps; scrolls horizontally |
| `diff` | `patch`, `wordDiff`, `collapsedPaths`, `maxLines`, `scroll` (bounded height only), `onToggleFile`, `onShowMore`, `onLineClick` |
| `img` | `src` (path, data URL, http), `objectFit`; set width and height; radius on the img itself |
| `svg` | `source` (markup). Monochrome, tinted by `style.color` (required) |
| `anchored` | `side`, `align`, `gap`, `offset`, `fit: "snap"`, `deferred`, `priority`, `occlude`, `fill: "window"` |

Native theme for markdown/code/diff: `{appearance, accent, bg, text, caret, fontSans, fontMono, syntax, metrics: {mdTextSize, mdLineHeight, mdBlockGap, mdHeadingSizes, codeTextSize, codeLineHeight, diffLineHeight, diffFileHeaderHeight}}`.
Bundled highlight languages: Rust, TS, TSX, JS, JSX, Python, Go, JSON, Bash, TOML, YAML, Markdown, HTML, CSS, C.

## Styles (`StyleDesc`, packages/native/js/host.ts)

- Sizes: number (px) or `"100%"`. Everything else px numbers. No shorthand strings, no calc/em/rem.
- Flex and grid (grid templates are a track count). `position: relative|absolute`, top/right/bottom/left. **No z-index**: tree order is paint order; use `<anchored deferred>` to paint on top.
- `backgroundColor`, `background` (2-stop linear gradient object), `opacity`, per-side `borderXWidth`, one `borderColor`, per-corner radii, `borderStyle: dashed`, `boxShadow` object/array, `outline*`.
- `boxShadow.blurRadius` spreads about twice as far as a CSS blur of the same number: halve web's blur (measured on the light composer shadow, `0 12px 28px -18px` → `blurRadius: 14`).
- Text: `fontSize`, `fontFamily`, `fontWeight`, `textAlign`, `lineHeight` (px), `whiteSpace: nowrap`, `textOverflow: ellipsis|ellipsis-start`, `lineClamp`, `textDecoration`. No letterSpacing, no italic, no `pre` (split lines yourself).
- `overflow*: hidden|scroll`, `scrollbarColor`, `scrollbarWidth`.
- `hover`, `active`, `focusVisible`: one level of nested state style, native. No group-hover: use `onMouseEnter`/`onMouseLeave` state for hover-reveal.
- `cursor`, `pointerEvents: auto|none`, `userSelect`, `selectionColor`.
- Animation: `motion.div` only (width/height/position/opacity/radius). No colour animation, no transforms, no spinners. T3 forbids continuously repainting animations anyway.

## Events

- Mouse: `onClick` (x, y, clickCount, modifiers), `onAuxClick` (right click → `isRightClick`; open your own menu), `onMouseDown/Up/Enter/Leave/Move`, `onMouseDownOutside`.
- Capture: an element with `onMouseDown` + `onMouseMove` captures the pointer (drag).
- `onFileDrop` `{paths}` (not on virtual-list).
- Keys: `onKeyDown/onKeyUp` with `key` (`"enter"`, `"escape"`, `"up"`, `"k"`), `keyChar`, `modifiers {shift, ctrl, alt, cmd}`, `preventDefault()`, `stopPropagation()`. Order: focused element → ancestors → `render({onKeyDown})` → default action.
- **Inside `<textarea>`, onKeyDown never sees Enter, Shift+Enter, Up/Down, Backspace, Delete, Left/Right, Home/End, cmd/ctrl+A/C/X/Z** (GPUI actions run first). Escape and Tab do arrive. A single-line `<input>` does not bind Up/Down.
- Modified chords do arrive in a focused `<textarea>` and then bubble to `render({onKeyDown})`: Ctrl/Alt+Enter, Ctrl+Shift+Enter, Alt+Up, Ctrl+S, Ctrl+Shift+<letter>, Ctrl+Alt+Shift+T (checked on Windows, gpuix 0.11.0). The composer handles the Enter chords itself (it needs the submit path) and leaves the rest to the window dispatcher in `keybindings/useGlobalKeybindings.ts`, where areas claim commands with `registerShortcutHandler`. `when: "composerFocus"` reads `composerFocusAtom`, which the composer sets on focus and on any key, since `focusElement` moves focus without `onFocus`.
- Focus: `tabIndex`, `autoFocus`, `onFocus/onBlur`, `renderer.focusElement(id)` (renderer from `useGpuixRequired()`).
- Scroll: `onScroll` (deltas), `onScrollChange` (offsets, overflow scroll only); `ref.scrollIntoView()`, `renderer.scrollTo`, `scrollToItem(id, index)`.
- `onLayout` (div/text, one frame late), `useWindowSize()`.
- No JS clipboard API. Copy works through selection and inputs. Terminal mode writes OSC 52.
- `renderer.promptForPaths({files, directories, multiple})` opens the OS file picker.

## Components

`@gpuix/react/{button,select,combobox,tooltip,dialog,floating}`, plus `DismissableLayer`, `createPortal`, `motion`, `AnimatePresence` from `@gpuix/react`. Escape closes the top layer of one per-window stack. `app/src/ui/overlay.tsx` wraps them in T3 styling: `Popover`, `Menu`, `MenuItem`, `MenuSeparator`, `MenuLabel`, `Select`, `Switch`, `Dialog`, `Tooltip`.

## Big-app gotchas

- **No nested vertical scrolling.** One vertical scroller per region. Collapse long inner content behind "Show more"; horizontal scroll inside is fine.
- Wheel events reach any scroller under the pointer. Overlays need `pointerEvents: "auto"`.
- Wrap long lists' rows in `memo`; use one native node (`markdown`, `code`, `diff`) for heavy content instead of many spans.
- GPUI rebuilds the whole window's element tree on every frame it draws, at roughly 10-15 µs per element on this hardware. Any keystroke or hover pays for every element on screen, so keep long lists off plain scrollers: `<virtual-list>` (windowed with `itemCount`/`windowStart` for long data), or cull off-screen rows into empty boxes of their measured height (the sidebar thread list does this).
- **Give stretched flex-column children a definite width along deep chains.** Taffy lays out a stretched child of an auto-width `flex column` twice (indefinite width, then stretched), the two calls miss each other's cache, and the work doubles per nesting level: ten settings rows under six plain column wrappers took 110 ms per frame, 4 ms with `width: "100%"` on the wrappers. For a child that is already stretched (no horizontal margin, parent `alignItems` stretch) `width: "100%"` lays out the same box. `T3TERM_PERF` + `{layout: name}` in `scripts/shot.ts` writes an audit (`src/dev/layoutAudit.ts`) ranking where it repeats.
- Derived atoms that rebuild an array/object on every upstream change re-render every subscriber; return the previous value (`get.self()`) when nothing changed. Never debounce a value that is a fresh object each render: the debounce re-fires forever.
- Elapsed-time labels share the aligned second tick (`sidebar/clock.ts` `nowSecondAtom`, `useNowEverySecond`): one commit and one frame per second, not one per label.
- Measuring: `T3TERM_PERF=<dir>` turns on `src/dev/perfProbe.ts` (draw percentiles and per-frame median, input-to-settle latency, per-region React time); `scripts/shot.ts` drives it with `{perf}` / `{perfEnd}` / `{repeat}` steps. Other work on this PC moves p90 by 2-3x; compare per-frame medians across interleaved runs.
- One renderer, one window. `bun --hot` remounts and loses state.
- `isTerminal()` (call during render) is true in kitty mode: no traffic lights, ctrl-c quits, no copy shortcut in text fields.

## Automation (screenshots)

`launch()` from `@gpuix/react/automation` runs the app as a child process over stdin. Locators: `getByTestId`, `getByText`, `.click()`, `.fill(text)`, `.press("ctrl-k")`, `.hover()`, `.wheel(dx, dy)`, `.waitFor()`. `app.screenshot({path})` writes a PNG of the GPU surface (Windows and macOS only). `app/scripts/shot.ts` wraps this.

## Terminal mode

`render(..., { terminal: true })` or `GPUIX_TERMINAL=1`: frames go through the kitty graphics protocol (shared memory locally, zlib+base64 inline over SSH). kitty and Ghostty only; macOS and Linux only (Windows throws). Window size follows the terminal. Fonts: Segoe UI/Consolas (Windows), Helvetica/Menlo (macOS), DejaVu (Linux) by default; `renderer.registerFont(ttfBytes)` adds more.

## Pointer findings from the Browser surface (gpuix 0.11.0, Windows)

- A press reaches **every** element under the pointer with `onMouseDown`, not only the topmost. If one of them also has `onMouseMove` it captures the pointer, and a child button underneath never sees its release, so its `onClick` never fires. Act on `onMouseDown` in such a child, or keep capturing listeners off its ancestors.
- Hover (`onMouseEnter`) goes to the topmost element only: a filled child (one with a background) ends its parent's hover. Give decorative children `pointerEvents: "none"`, or share one hover across parent and children.
- A child cannot re-enable pointer events under a `pointerEvents: "none"` parent. Keep a full-cover `none` layout probe as a sibling of interactive overlays, not their parent.
- `<img style={{ height: "100%" }}>` resolved against an outer definite ancestor rather than its flex parent; size live images in px from `onLayout`.
- `renderer.focusElement(inputId)` focuses an `<input>` without firing its `onFocus`; check `renderer.getFocusedElementId()` and set any focused state yourself.
- Negative margins on a row's children (web's `-mx-0.5` on a leading icon) collapsed a content-sized floating menu to its `minWidth` and truncated its text. Give the icon a narrower fixed-width slot and let it overflow centered instead.

## Text editing findings from the Files editor (gpuix 0.11.0, Windows)

- Sibling `<text>` elements in a block `div` stack as separate lines; they only sit on one line as flex items, and then each run's box is rounded to whole pixels, so a long run of tokens drifts by up to a pixel per token. To line glyphs up with something else (a textarea), place each run absolutely at `column × ch`.
- A `<textarea>` soft-wraps with GPUI's line wrapper (`compute_wrap_boundaries`), not CSS rules. `panels/code/codeRows.tsx` `gpuiWrapBoundaries` reproduces it for monospaced text, so painted rows break where the textarea breaks.
- `<textarea>` defaults to `maxRows` 10 and then scrolls inside; give it `height` (or a large `maxRows`) when it must show all its lines.
- A textarea that takes focus (`autoFocus`, or `renderer.focusElement`) in the frame its `<virtual-list>` row first appears scrolls that row to the top. Mount it unfocused and remount it with `autoFocus` a frame later (`panels/diff/DiffCommentAnnotation.tsx`).
- A transparent-text textarea (`color: "#00000000"`) still draws its caret and selection: that is how `panels/files/FileEditor.tsx` edits over highlighted rows.
- Drag inside a list whose rows hold their own buttons (the sidebar thread list): the row captures (`onMouseDown` + `onMouseMove`), and its controls claim the press on mouse down instead of using `onClick` (`sidebar/sidebarGesture.ts` `claimRowPress`); the row runs the claimed action on its own click unless the press became a drag. A captured element must stay mounted for the whole gesture, so a dragged row stays in place (invisible) and a copy paints last as the lifted ghost. `position: "relative"` + `top` shifts an item without moving its siblings, like a CSS transform, but unlike a transform it does not grow the scroller's content: pad the end yourself if items shift past it.
- Automation clicks (`scripts/shot.ts` `dblclick`) always report `clickCount: 1`; double-click handlers that must work under automation also time consecutive clicks.
- A `position: absolute` box ends the hit test for whatever lies under it, even with no background (style.rs `should_occlude`). Absolutely positioned decoration over a click target (terminal grid rows and text runs, a hidden page layer) needs `pointerEvents: "none"`, or clicks and click-to-focus never reach the target (found on the thread terminal and the provider sign-in terminal).

## Findings from chat markdown (gpuix 0.11.0, Windows)

- **No inline formatting context.** Each `<text>` is one box with one style; a run that wraps takes the full width, so mixed-style prose cannot flow as one paragraph of host elements. `chat/markdown/` lays inline content out in JavaScript (`inline.ts`) and paints each line as a row of nowrap runs.
- **Text elements are the expensive ones**: ~25-35 µs per `<text>` per frame here, ~5 µs per `<div>`. A bare string child of a div is one element (a `<text>` is two: host + string) and inherits the div's font, color, line height and `whiteSpace`; prefer bare strings for runs in the parent's style.
- **Widths for JS layout come from GPUI**: a hidden nowrap `<text>` of one character repeated 20× reports its width through `onLayout` (integer px). Summed per-character advances matched GPUI's shaped width of 500 px lines within ~1 px (no kerning visible with Segoe UI / Consolas). `chat/markdown/measure.ts` caches advances in `$T3TERM_HOME/text-metrics.json`.
- **Copy joins runs with newlines**: `getSelectedText()` puts `\n` between runs unless they are adjacent bare strings of one parent. The markdown renderer ends continuing runs with U+2060 (zero width, not painted) and `chat/markdown/copy.ts` handles Ctrl/Cmd+C to drop the marker and its newline.
- **`<img>` renders SVG text** from data URLs (usvg with system fonts), so full-colour SVG (Mermaid via pele, MathJax output) works through `<img src="data:image/svg+xml;base64,...">`. usvg has no CSS custom properties: inline `var(--x)` before handing the SVG over. `<img>` has no load/error events: fetch and validate bytes first if a fallback is needed.
- **Auto-width chains multiply layout**: a content-sized bubble around markdown laid the subtree out once per auto-width ancestor (8× in the user bubble). Give the wrappers the content's width once it is known.
