# T3 Code web UI spec

Read from `vendor/t3code/apps/web/src` (alias `@` below). Tailwind v4 defaults:
1 spacing unit = 4px, root font 16px, desktop (`sm:`) values throughout.
Tokens are in `app/src/ui/theme.ts`. Reference screenshots: `E:\w\refshots\out`.

## A. Surface inventory

### App shell
- Root: `@/routes/__root.tsx:211-264`: CommandPalette > AppSidebarLayout > route outlet. ToastProvider top-right. FirstRunGate/WelcomeWizard, global dialog hosts.
- Layout `@/components/AppSidebarLayout.tsx:397-444`: left Sidebar, page, fixed sidebar toggle. Sidebar is `ThreadSidebar` (default) or `LegacySidebar` (project tree, off by default). On `/settings` the sidebar shows `SettingsSidebarNav`.
- Sidebar width `@/components/threadSidebarWidth.ts`: default 256, min 208, max viewport − 640.
- Chat route → `@/components/ThreadRouteView.tsx` → `@/components/ChatView.tsx:3156-3891`: header (`:3175`), `ChatCanvas` (banner lane, timeline, ScrollToEndButton, composer overlay `:3400-3721`, mini player, ThreadDetailsPanel), `ChatTerminalDrawers` at the bottom of the chat column, `ChatRightPanel` beside it (`:3832-3885`).
- Right panel `@/components/chat/ChatRightPanel.tsx` → `RightPanelTabs.tsx`: Browser, Terminal, Files, Diff, Pull request, Linked PRs, Device. Width default 540, min 360, max 70%. Below 980px viewport it becomes a sheet.
- Terminal drawer `@/components/ThreadTerminalDrawer.tsx:1810-1870`: default height 280, min 180, max 75% viewport; 6px resize strip; split/new/close buttons.
- Diff panel `@/components/DiffPanel.tsx` (header `:666-921`), `DiffPanelShell.tsx`, renders `@pierre/diffs`.
- Files `@/components/files/FileBrowserPanel.tsx`, `FilePreviewPanel.tsx`.
- Thread details card `@/components/chat/ThreadDetailsPanel.tsx:102-209`, `ThreadDetailsCard.tsx:123-137`: Workspace (run context, OpenInPicker, ProjectScripts), Version Control (branch, GitActionsControl), Automations, Relationships. Row styles `threadDetailsPanelStyles.ts`.

### Sidebar (default) `@/components/Sidebar.tsx:2629-3182`
- Brand header `sidebar/SidebarChrome.tsx:34-132`; search/filter/add project/new thread `sidebar/SidebarThreadHeader.tsx:63-177`; project-filter combobox `Sidebar.tsx:2641-2762`.
- Order: draft block (`SidebarDraftBlock.tsx`), Pinned, Active (cards), Working shelf (cards), Snoozed shelf (slim), Settled shelf (slim) with "Show N more" (`Sidebar.tsx:2996-3144`). Shelf headers `SidebarListMarkers.tsx:102-135` + `ui/collapsible-section-header.tsx`.
- Thread row `sidebar/SidebarThreadRow.tsx`: statuses `:651-700`, surface `:886-905`, slim row `:1075-1231`, card row `:1235-1492`, search result row `:1583+`.
- Empty states: "No projects yet" + "Add project", "No threads yet", "No threads found".
- Footer `SidebarChrome.tsx:159-240`: undo notice, provider update pill, utility row (Settings, Pull Requests, Usage, update pill).
- Logic: `Sidebar.logic.ts` (sections, status pills, search, adjacency), client-runtime `state/threadSettled.ts`, `threadSort.ts`, `threadInbox.ts`.

### Chat timeline `@/components/chat/MessagesTimeline.tsx` (row dispatch `:1193-1274`)

| Row | Component |
|---|---|
| User message | `TimelineUserMessageRow.tsx:417-629` (steer marker, "Edit from here" revert, collapse) |
| Assistant markdown | `TimelineAssistantRows.tsx:26-58`, meta (copy/fork/time) `:144-193`, `ChatMarkdown.tsx` |
| Tool calls / work log | `WorkLog.tsx`, `TimelineWorkGroupRows.tsx` (Working, Thinking, group toggle), `TimelineWorkEntryRow.tsx`, icons `TimelineToolActivityIcon.tsx` + `TimelineWorkEntryRow.logic.ts` |
| Changed files | `ChangedFilesTree.tsx:54-230` |
| Plans | `ProposedPlanCard.tsx:163-235` |
| Approvals | `ComposerPendingApprovalPanel.tsx` + `ComposerPendingApprovalActions.tsx` (banner above composer, `ChatComposer.tsx:3517-3576`) |
| User-input questions | `ComposerPendingUserInputPanel.tsx` |
| Errors | `ThreadErrorBanner.tsx`, `ChatBannerLane.tsx`, `ProviderStatusBanner.tsx` |
| Folds / dividers | turn fold `:1336-1358`, attempt fold `:1360-1379`, compaction `:1298-1334`, `TimelineSystemDivider.tsx` |
| Other | `WorktreeSetupCard.tsx`, `TimelineMinimap.tsx`, `ThreadFindBar.tsx` |

### Composer `@/components/chat/ChatComposer.tsx:3412-3990`
- Surface `ComposerSurface.tsx`; editor `@/components/ComposerPromptEditorTiptap.tsx`.
- Model picker `ProviderModelPicker.tsx`, `ModelPickerContent.tsx`, `ModelPickerSidebar.tsx`; effort `TraitsPicker.tsx`; plan toggle + runtime mode `ComposerFooterControls.tsx`, `runtimeModeConfig.ts` (Supervised / Auto-accept edits / Auto / Full access); controls bar `ComposerControlsBar.tsx:164-329`.
- Attachments `ComposerAttachmentStrip.tsx`; slash/@/$ menu `ComposerCommandMenu.tsx`, `composerSlashCommandSearch.ts`, `@/composer-editor-mentions.ts`.
- Send/stop/queue/steer `ComposerPrimaryActions.tsx:131-399`; queue `QueuedRunsControl.tsx`; stash `ComposerStashBadge.tsx`; banners `ComposerBanner.tsx`, `ComposerBannerStack.tsx`; context strip `@/components/BranchToolbar.tsx:755-860`; context meter `ContextWindowMeter.tsx`.

### Header
- `chat/ChatHeader.tsx:268-410`: project favicon + name, optional parent thread, title (click opens actions menu, double-click renames).
- `chat/PanelLayoutControls.tsx:52-213`: details, terminal, right panel, maximize toggles.
- Git actions + open-in live in the details card: `GitActionsControl.tsx` (labels `GitActionsControl.logic.ts:149-332`), `chat/OpenInPicker.tsx`.

### Settings (`@/routes/settings.tsx`, nav `settings/SettingsSidebarNav.tsx`, primitives `settings/settingsLayout.tsx`)

| Page | Component | Sections |
|---|---|---|
| General | `SettingsPanels.tsx:785-1981` | New threads (model, permissions, workspace, submodules), Organization, Behavior, Projects & threads, Confirmations, Text generation, About, Diagnostics |
| Appearance | `AppearanceSettingsPanel.tsx` | Colors & themes, Interface (typography), Motion |
| Project | `ProjectsSettings.tsx` | Checkouts, Project, Danger |
| Keybindings | `KeybindingsSettings.tsx` | table + "New keybinding" |
| SnapShots | `SnapShotSettings.tsx` | |
| Providers | `ProviderSettingsPanel.tsx`, `ProviderInstanceCard.tsx` | Models, Setup, Advanced |
| Integrations | `IntegrationsSettings.tsx` | |
| Scheduled Tasks | `ScheduledTasksSettings.tsx` | |
| Source Control | `SourceControlSettings.tsx` | |
| Storage | `StorageSettings.tsx` | |
| Connections | `ConnectionsSettings.tsx` | Environments, Authorized clients |
| Archive | `ArchivedThreadsPanel.tsx` | |
| Diagnostics | `DiagnosticsSettings.tsx` | |

### Other
- Command palette `@/components/CommandPalette.tsx`, primitives `ui/command.tsx`. Actions: New thread, New thread in…, without a project, Find in thread, Copy thread ID, Link PR, Show linked PRs, Restart agent session, Go to file, Search project contents, Add project, Open pull requests, Usage, Settings, Change theme.
- Dialogs `ui/dialog.tsx`, `ConfirmDialogHost.tsx`, `AddProjectToMachineDialog.tsx`, `PullRequestThreadDialog.tsx`, `CustomSnoozeDialog.tsx`, `search/ProjectContentSearchDialog.tsx`, `files/ProjectFilePicker.tsx`.
- Onboarding `onboarding/FirstRunGate.tsx`, `WelcomeWizard.tsx`. Empty states `NoActiveThreadState.tsx`, `NoProjectsHero.tsx`.
- Routes: `usage.tsx`, `_chat.pull-requests.tsx`, `pair.tsx`, `connect.tsx`.
- Keybindings `packages/shared/src/keybindings.ts:148-233`: mod+B sidebar, mod+J terminal, mod+alt+B right panel, mod+shift+B details, mod+D diff, mod+K palette, mod+P file picker, mod+shift+F project search, mod+N new thread, mod+shift+N new thread in project, mod+alt+N without project, mod+F find, mod+shift+M model picker, mod+shift+E effort, mod+shift+A mode, mod+shift+G branch, mod+S stash, mod+shift+[ / ] prev/next thread, mod+1..9 jump, mod+shift+S settle, mod+shift+P pin, mod+Z thread undo, mod+U usage.

## B. Tokens (see `app/src/ui/theme.ts`)

- Dark: background #0a0a0a, foreground #f5f5f5, card/popover #111111, primary #346bf1, muted-fg #818181, accent white 4%, message surface #141414, border white 6%, input white 8%, error #fb414a / fg #ff6467, info #2b7fff / #51a2ff, success #00bc7d / #00d492, warning #fe9a00 / #ffb900.
- Sidebar dark: bg #000, fg #f1f3f7, muted-fg #a3a3a3, row-hover fg 8%, row-active fg 11%, row-selected fg 7%, border white 8%, icon #626262.
- Fonts: sans system (Segoe UI / SF), mono ui-monospace. Sizes: interface 16 root, prompt 14, code 13. Scale 2xs 11/16, xs 12/16, sm 14/20, base 16/24, lg 18/28, xl 20/28, 2xl 24/32, 3xl 30/36.
- Markdown: body 14px, line-height 1.625 (≈23), fg 80%; h1 20, h2 18, h3 16, h4-6 14, weight 600; inline code 12px radius 6 bg muted; pre radius 12 bg muted padding 12.8/14.4; links info-fg.
- Radii: sm 6, md 8, lg 10, xl 14, 2xl 18, 3xl 22; control radius 8.
- Layout: topbar 52; titlebar controls 28 with 12 gap; chat max width 736; chat lane padding 48; details card 280 wide; workspace gutter 20.
- Shadows: menus `0 16px 40px -18px rgba(0,0,0,.55)`; dialog dark `0 24px 72px -20px rgba(0,0,0,.9)`.
- Icons: lucide 0.564 (`app/src/ui/Icon.tsx`, any lucide name in kebab case).

Icon map: sidebar toggle PanelLeft/PanelLeftClose · search Search · project filter ListFilter · add project FolderPlus · new thread SquarePen · settings Settings · usage ChartNoAxesColumn · back ArrowLeft · header SquareMenu, PanelBottom, PanelRight, Maximize2 · statuses CircleDashed (working), CircleDotDashed (waiting), ShieldQuestion (approval), MessageCircleQuestion (input), CircleAlert (failed), CircleCheck (done), AlarmClock (woke) · pin Pin/PinOff · settle Check/Undo2 · attach Paperclip · effort Brain · Build/Plan Bot/PencilRuler · runtime Lock/PenLine/Sparkles/LockOpen · resume/steer/queue Play/CornerUpRight/ListPlus · branch GitBranch · workspace Folder/FolderGit2 · tool rows Eye (read), SquarePen (edit), Terminal (command), Globe (web), Search, Wrench, Hammer, Brain, Bot, Zap · toasts CircleAlert/Info/CircleCheck/TriangleAlert · approval Shield · settings nav Settings2, Palette, PanelsTopLeft, Keyboard, Bot, Blocks, CalendarClock, GitBranch, HardDrive, Link2, Archive.

### Controls
| Control | Spec |
|---|---|
| Button | radius 8, 14px medium; default 32 tall px 11; sm 28 px 9; xs 24 px 7 12px; icon 32, icon-sm 28, icon-xs 24, icon-micro 20 (radius 6); icons 16 (14 xs) |
| Variants | default primary bg white text; ghost transparent hover accent icon muted; ghost-muted muted text; outline border input |
| Toggle | 28×28 radius 10; pressed accent bg |
| Select trigger | min-h 32 radius 10 border input px 11 14px chevron 16 min-w 144 |
| Switch | 30×18 track, 14 thumb, on primary, off input |
| Tooltip | radius 8 border popover bg 12px padding 4×8 max-w 320 |
| Menu | radius 10 padding 4 min-w 160; item min-h 28 radius 6 px 8 14px highlight accent |
| Badge | 18 tall 12px radius 6 |
| Dialog | radius 18, border, max-w 512; header padding 24, title 20 semibold; footer border-t bg muted 72% py 16 px 24 |
| Command palette | 10vh from top, max-w 576, max-h 420; items py 6 highlight fg 9%; footer bg fg 2.5% py 10 px 16 |
| Toast | top-right inset 32, max-w 360, radius 10, content py 12 pl 14, icon 16 tinted |

## C. Key layouts

### C1. Sidebar (256 wide)
- Container: full height, bg sidebar, 1px right border.
- Header 52: sidebar toggle 28×28 at left 12 (PanelLeftClose 16), brand "T3" wordmark + "Code" 14 medium muted at left 52.
- Fixed group padding 8: search field (flex 1, h 32, radius 8, padding 6/8, gap 8, Search 16 sidebar-icon, "Search" 14 medium sidebar-muted) + 4 gap + three 28×28 icon buttons (ListFilter, FolderPlus, SquarePen).
- List padding 0/8/8, gap 1:
  - Card row: li padding 2 vertical; surface radius 8, hover row-hover, current row-active; inner 78 tall padding 8/10. Line 1 (h 20, gap 6): favicon 16 · project name 12 medium muted truncate · right slot min-w 32: status (icon 16 + label; Working info + duration; Approval warning-fg; Input indigo; Failed error; Done success) or relative time. On hover the slot becomes Discard (X 14), Snooze, "Settle" (Check 14 + text). Line 2 (mt 4): title 14 medium fg 90% (100% if unread). Line 3 (mt 2, 12px, gap 6): worktree icon + branch (muted 40%), terminal status, PR badge, "+N −N" mono diff colors, provider icon stack right.
  - Slim row: h 36, px 10, gap 10, radius 8; favicon 16 at 40% grayscale; title 14 muted 70%; right slot time 12px, hover → Check button.
  - Shelf header: li h 32 mx 2; button h 32 px 8 gap 8 radius 8 12px medium: label · 1px flex line · 12px chevron. Muted tone label sidebar-muted 60%, line border 60%. Snoozed tone blue-400, line blue-500 20%. First shelf header has margin-top auto (shelves sit at the bottom).
  - Draft block: same 78px card with SquarePen icon, then 1px divider (margin 6/10).
- Footer padding 4/8: 32×32 icon buttons Settings, Pull Requests, Usage; update pill at the end.

### C2. Empty / new thread (draft hero)
- Header 52 breadcrumb: favicon 14 + project name muted, "/" icon-muted, title fg; 14 medium, gap 12.
- Composer overlay vertically centered; lane padding 48; max-w 736.
- Headline above composer (pb 16): centered h1 30px normal: "What should we build in **[project]**?" (project picker is an inline button with dotted underline; opens a 288-wide combobox). Below: "or start without a project" muted 14px.
- Server thread with no messages: centered "Send a message to start the conversation." 14px muted 30%.
- No thread: "Pick a thread to continue" in a max-w 512 box.

### C3. Active chat
- Header 52, px 20; breadcrumb flex 1 with pr 96; title 14 medium + ChevronDown 14 on hover. Toggles group at right 12: 28×28 ghost, 16 icons, gap 4 (SquareMenu, PanelBottom, PanelRight); pressed accent.
- Timeline: scroll container px 48, rows centered max-w 736, 24px top spacer. Spacing after rows: 16 after user messages; 8 after assistant/events; 6 after folds/Working.
- User message: right-aligned column gap 4; bubble max-w 80%, radius 18, padding 12, bg message-surface, 14px/22.75 fg. Images: 2-col grid max-w 210, 4:3, radius 10. Long messages collapse to 176 with fade + "Show full message" xs ghost. Hover meta: 12px muted timestamp, Undo2 "Edit from here", copy. Optional "Steer" marker above (Redo2 12 + 12px muted).
- Assistant: padding 2/4, markdown 14px fg 80%. Hover meta mt 6 12px muted: copy, fork (GitFork 12), timestamp. Changed files card mt 16 radius 10 bg secondary: header padding 8/12 12px medium counts + "Open diff" (FileDiff 12); rows h 28 radius 8 hover accent 60%, file icon 14, path 11px mono muted 90%, counts 10px mono right.
- Work log line: min-h 24, gap 6, 14px; icon slot 24 wide, icon 16 icon-muted; label muted truncate; optional 12px timestamp. Row padding 2/2 radius 8. Expanded detail ml 28 max-h 384 padding 4/2 scrolls. Groups collapse to a toggle row ("Read 3 files"). Failed tools: X 12 in tool-error.
- Working row: bottom border border/60, pb 8 pt 4, 24px line, 14px muted "Working for 12s".
- Thinking row: Brain icon + "Thinking"; preview clamps to 4 lines.
- Turn fold: bottom border border/60, padding 4/8, 14px muted label + ChevronRight/Down 14, timestamp right.
- Plan card: radius 22, border 80%, bg card 70%, padding 20; header "Plan" badge + title 14 medium + 24px outline Ellipsis button; body markdown, collapsed at 416 with 96px fade, "Expand plan" sm outline centered mt 16.
- Approval banner above composer: width composer − 44, top radius 18, outline warning 28%, tint warning 8%, padding 12, overlaps composer by 17. Grid [Shield 16 warning][content][actions]: 11px muted line with label in warning medium + "1/N"; detail text; xs buttons (Accept primary, others outline, More icon).
- Pending user input: same banner, info variant; options 14 medium + 11px descriptions; selected shows Check 14 primary.
- Scroll to end: centered pill xs ChevronDown 14 + "Scroll to end", 4px above composer.

### C4. Composer
- Overlay absolute bottom, pt 8, lane px 48, max-w 736, 20px spacer below.
- Shell radius 22: dark #111111 at 80% (blur 16 on web), 1px outline white 5%, inset highlight white 3%.
- Body padding 16/16/8; editor 14px, placeholder muted 75% "Ask anything, @tag files/folders, $use skills, or / for commands" (empty thread: "Ask for changes, send follow-ups, or attach images").
- Footer row space-between padding 0/16/16. Left controls (each h 28, px 10, gap 6, radius 8, 14 medium secondary-label, icons 16 muted, hover accent): model picker (shifted −10px: provider icon + model + ChevronDown 14 stroke 2.25) · 1×16 separator · effort (Brain + label + chevron) · separator · Build/Plan toggle (Bot 18 "Build" / PencilRuler "Plan", accent bg when pressed) · separator · runtime select (Lock + "Supervised"/"Full access" + chevron).
- Right (gap 8): attach ghost 28 Paperclip 16; context meter ring 20; send 32×32 circle message-action with white arrow-up 14 (stroke 1.8), disabled 64%. Running: Stop = 32 circle destructive 90% with 8×8 white square radius 1.5. Pill buttons (Implement / Submit answer) h 32 px 16 rounded full message-action 14 medium.
- Context strip below (mt −16, width − 44, padding 20/8/4, gap 4, 12px muted 70%): run context control (Folder/FolderGit2 12 + "Local"/"Worktree" + chevron), optional environment selector, branch selector right-aligned (GitBranch + name + chevron).

### C5. Settings — General
- Sidebar: brand row 52; search row (h 32 radius 8 padding 6/8, Search 16, "Search", Kbd "/"); menu rows h 32 px 10 gap 8 radius 8 14 medium sidebar-muted 80%, icon 16; active row-selected + fg. Items: General, Appearance, Keybindings, SnapShots, Providers, Integrations, Scheduled Tasks, Source Control, Storage, Connections, Archive. Footer "Back" (ArrowLeft).
- Main header 52 px 20: "Settings" (14 medium muted) / "General" (fg); right "Restore device defaults" xs ghost (RotateCcw 14).
- Container max-w 896 centered, padding 24/24/48, column gap 32. Scope sentence "Applying settings for [All projects ▾] across [All environments ▾]" 16px muted px 16.
- Section: gap 10; title row min-h 28 px 16 14px fg 70%; group radius 14, border border/60, bg card 40%; rows divided by 1px border/50.
- Row padding 12/16; ≥512 wide: grid [1fr, auto] gap 32 centered. Left: h3 14 medium fg (+ inheritance badge, reset button 20×20); description 12px lh 1.5 muted 80% max-w 576. Right: control (switch, select min-w 144, sm outline buttons).
