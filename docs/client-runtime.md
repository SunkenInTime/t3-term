# Driving a T3 server from t3-term

Paths are relative to `vendor/t3code`. Line numbers are from commit `05cd55d2`.

## Wiring already done

- `app/src/runtime/runtime.ts`: `connectionAtomRuntime = Atom.runtime(Connection.layerWithOptions(...) + snapshot loaders + platform)`, and `appAtomRegistry`.
- `app/src/runtime/platform.ts`: Bun fetch/WebSocket/WebCrypto, JSON-file connection catalog (`$T3TERM_HOME/connection-catalog.json`, default `~/.t3-term`), no-op offline cache, `ClientPresentation` surface `cli`.
- `app/src/state/environment.ts`: `environmentCatalog`, `environmentSession`, `serverEnvironment`, `environmentShell`, `environmentSnapshotAtom`, `environmentProjects`, `projectEnvironment`, `threadEnvironment` (thread commands), `environmentThreads` (per-thread state), `environmentThreadDetails`, `environmentThreadShells`, `projectIndexAtom`.
- React: `RegistryContext.Provider value={appAtomRegistry}` is mounted; use `useAtomValue`, `useAtomSet`, `useAtom` from `@effect/atom-react`.

## Auth

- `t3 auth session issue --base-dir X --token-only` → bearer token (standard scopes). Dev token: `E:\w\ref\t3term-dev-token.txt`.
- Pairing: `ConnectionOnboarding.registerPairing({ pairingUrl } | { host, pairingCode })` exchanges a one-time code for a bearer at `POST /oauth/token`. Wired in `app/src/connect/bootstrap.ts`.
- `GET /.well-known/t3/environment` is the public descriptor (environmentId, label, protocol version, capabilities).

## State (all from `packages/client-runtime/src/state`)

| Need | Atom |
|---|---|
| Connection status per environment | `environmentCatalog.stateAtom(envId)` (`SupervisorConnectionState`: phase, stage, lastFailure) |
| Projects + thread list | `environmentShell.stateValueAtom(envId)` → `{snapshot, status, error}`; `environmentThreadShells.navigationThreadShellsAtom` (all non-archived top-level threads, `EnvironmentThreadShell` from `state/models.ts`), `threadShellAtom(ref)` |
| One thread | `environmentThreads.stateAtom(envId, threadId)` → `AsyncResult<EnvironmentThreadState>`; `.data: Option<OrchestrationV2ThreadProjection>` (`thread, runs, messages, turnItems, visibleTurnItems, runtimeRequests, plans, checkpoints…`, contracts `orchestrationV2.ts:1748`) |
| Derived thread detail | `environmentThreadDetails.*` (`visibleTurnItemsAtom`, `pendingRequestsAtom`, `checkpointSummariesAtom`, `historyAtom`), `derivePendingThreadRequests` (`state/threadRequests.ts`) |
| Server config, providers, models, settings, keybindings | `serverEnvironment.configValueAtom(envId)` (`ServerConfig`) |
| Git status / refs / worktrees | `createVcsEnvironmentAtoms(rt)` (`state/vcs.ts`) |
| Terminal | `createTerminalEnvironmentAtoms(rt)`: open, write, resize, clear, restart, close; `attach`, `observe`, `metadata` subscriptions (`state/terminal.ts`, reducer `state/terminalSession.ts`) |
| Diffs | `orchestration.getTurnDiff` / `getFullThreadDiff` via `state/orchestration.ts`; `review.getDiffPreview` |

Web's own wiring of each factory is in `apps/web/src/state/*.ts`; mobile's in `apps/mobile/src/state/*.ts`. Copy their instantiation into `app/src/state/<area>.ts`.

## Commands

`AtomCommand` objects; run with `runAtomCommand(appAtomRegistry, command, { environmentId, input })` from `@t3tools/client-runtime/state/runtime`. Results are `AsyncResult` (`_tag: "Success" | "Failure"`). Use the factories, not raw RPC: raw RPC rejects scope-guarded methods (`CLIENT_GUARDED_RPC_SCOPES`).

| Action | Command | Wire |
|---|---|---|
| Create project | `projectEnvironment.create` (`state/projectCommands.ts`) | `projects.mutate project.create` |
| New thread + first message (optionally new worktree) | `threadEnvironment.startTurn` with `bootstrap.createThread`, `bootstrap.prepareWorktree` | `orchestration.launchThread` (`operations/commands.ts:624`); mobile builder `apps/mobile/src/lib/projectThreadStartTurn.ts` |
| Send message | `threadEnvironment.startTurn {threadId, message:{messageId, role:"user", text, attachments}, modelSelection, runtimeMode, interactionMode, dispatchMode}` | `message.dispatch` (`start_immediately`, `queue_after_active`, `steer_active`, `restart_active`) |
| Interrupt | `interruptTurn` | `run.interrupt` / `thread.stop` |
| Approvals / user input | `respondToApproval`, `respondToUserInput`, `dismissUserInput` | `runtime-request.respond` |
| Plan mode | `setInteractionMode {interactionMode: "plan"|"default"}`; implement plan = `startTurn` + `sourceProposedPlan` | |
| Runtime mode | values `approval-required`, `auto-accept-edits`, `auto`, `full-access` (`contracts/src/providerPolicy.ts`) | |
| Rename / archive / delete / pin / settle / snooze | `updateMetadata`, `archive`, `unarchive`, `delete`, and the settle/snooze/pin commands in `state/threadCommands.ts` | |
| Revert checkpoint | `revertCheckpoint` | `checkpoint.rollback` |
| Commit / push / PR | `createVcsActionManager(rt).runStackedAction({environmentId, cwd})` with `action: commit|push|create_pr|commit_push|commit_push_pr` (`state/vcsAction.ts`) | stream RPC `git.runStackedAction` |
| Worktree | `vcsEnvironment.createWorktree` | `vcs.createWorktree` |
| Settings | `server.updateSettings` command (`state/server.ts`) | |

Method tables: `WS_METHODS` (`packages/contracts/src/rpc.ts:380`), `ORCHESTRATION_V2_WS_METHODS` (`orchestrationV2.ts:3086`). Model selection `{instanceId, model, options?}` (`contracts/src/modelSelection.ts`); choices come from `ServerConfig.providers`.

## Running a server yourself

```
T3CODE_HOME='E:\w\scratch-home' node apps/server/src/bin.ts serve --base-dir 'E:\w\scratch-home' --port 23773 --host 127.0.0.1
```

`serve` is headless and prints a pairing token. Never point at `E:\.t3` (Dara's live install).
