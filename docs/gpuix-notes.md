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
- One renderer, one window. `bun --hot` remounts and loses state.
- `isTerminal()` (call during render) is true in kitty mode: no traffic lights, ctrl-c quits, no copy shortcut in text fields.

## Automation (screenshots)

`launch()` from `@gpuix/react/automation` runs the app as a child process over stdin. Locators: `getByTestId`, `getByText`, `.click()`, `.fill(text)`, `.press("ctrl-k")`, `.hover()`, `.wheel(dx, dy)`, `.waitFor()`. `app.screenshot({path})` writes a PNG of the GPU surface (Windows and macOS only). `app/scripts/shot.ts` wraps this.

## Terminal mode

`render(..., { terminal: true })` or `GPUIX_TERMINAL=1`: frames go through the kitty graphics protocol (shared memory locally, zlib+base64 inline over SSH). kitty and Ghostty only; macOS and Linux only (Windows throws). Window size follows the terminal. Fonts: Segoe UI/Consolas (Windows), Helvetica/Menlo (macOS), DejaVu (Linux) by default; `renderer.registerFont(ttfBytes)` adds more.
