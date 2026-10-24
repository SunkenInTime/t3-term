// The offline cold-start cache: the last shell, thread, server config and VCS ref
// snapshots each environment sent, so a restart with the server unreachable still
// shows what was loaded before. Same records, schema versions and semantics as
// web's IndexedDB stores (apps/web/src/connection/storage.ts, `cacheStore`), one
// JSON file per record under $T3TERM_HOME/environment-cache.
//
// Like web there is no eviction: a thread's record goes when the thread is
// deleted (removeThread), and everything an environment saved goes when the
// environment is removed (clear).
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

import {
  ORCHESTRATION_CACHE_SCHEMA_VERSION,
  ORCHESTRATION_THREAD_CACHE_SCHEMA_VERSION,
  StoredOrchestrationShellSnapshot,
  StoredOrchestrationThreadSnapshot,
  decodeOrDiscardOrchestrationCache,
  makeStoredShellSnapshotEncoder,
  Persistence,
} from "@t3tools/client-runtime/platform";
import { EnvironmentId, ServerConfig, VcsListRefsResult, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { termHome } from "./paths.ts";

// Bump when the file layout changes; record shapes carry their own schemaVersion.
const LAYOUT_VERSION = "v1";

const StoredServerConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: EnvironmentId,
  config: ServerConfig,
});
const StoredVcsRefs = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: EnvironmentId,
  cwd: Schema.String,
  refs: VcsListRefsResult,
});
const decodeStoredShellSnapshot = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredOrchestrationShellSnapshot));
const decodeStoredThreadSnapshot = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredOrchestrationThreadSnapshot));
const encodeStoredThreadSnapshot = Schema.encodeEffect(Schema.fromJsonString(StoredOrchestrationThreadSnapshot));
const decodeStoredServerConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredServerConfig));
const encodeStoredServerConfig = Schema.encodeEffect(Schema.fromJsonString(StoredServerConfig));
const decodeStoredVcsRefs = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredVcsRefs));
const encodeStoredVcsRefs = Schema.encodeEffect(Schema.fromJsonString(StoredVcsRefs));

type CacheOperation = Persistence.ConnectionPersistenceError["operation"];

function persistenceError(operation: CacheOperation, cause: unknown) {
  return new Persistence.ConnectionPersistenceError({
    operation,
    message: `Could not ${operation.replaceAll("-", " ")}: ${String(cause)}`,
  });
}

/** Ids become file names on every OS: anything outside [A-Za-z0-9_-] is percent-encoded. */
function fileSafe(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, (character) =>
    Array.from(new TextEncoder().encode(character), (byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join(""),
  );
}

// A cwd is a long path; hashing keeps the name short. The record stores the cwd
// and loads compare it, as web's keyed reads do, so a collision only misses.
function cwdFileName(cwd: string): string {
  return NodeCrypto.createHash("sha256").update(cwd).digest("hex");
}

function cacheRoot(): string {
  return NodePath.join(termHome(), "environment-cache", LAYOUT_VERSION);
}

function environmentDir(environmentId: EnvironmentId): string {
  return NodePath.join(cacheRoot(), fileSafe(environmentId));
}

const paths = {
  shell: (environmentId: EnvironmentId) => NodePath.join(environmentDir(environmentId), "shell.json"),
  serverConfig: (environmentId: EnvironmentId) => NodePath.join(environmentDir(environmentId), "server-config.json"),
  thread: (environmentId: EnvironmentId, threadId: ThreadId) =>
    NodePath.join(environmentDir(environmentId), "threads", `${fileSafe(threadId)}.json`),
  vcsRefsDir: (environmentId: EnvironmentId) => NodePath.join(environmentDir(environmentId), "vcs-refs"),
  vcsRefs: (environmentId: EnvironmentId, cwd: string) =>
    NodePath.join(environmentDir(environmentId), "vcs-refs", `${cwdFileName(cwd)}.json`),
};

const readRecord = (file: string) =>
  Effect.tryPromise({
    try: () =>
      NodeFS.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    catch: (cause) => cause,
  });

let nextTempId = 0;

// Write-then-rename, so a crash mid-save leaves the previous record rather than half a file.
const writeRecord = (file: string, contents: string) =>
  Effect.tryPromise({
    try: async () => {
      await NodeFS.mkdir(NodePath.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${nextTempId++}.tmp`;
      try {
        await NodeFS.writeFile(tmp, contents, { mode: 0o600 });
        await NodeFS.rename(tmp, file);
      } catch (error) {
        await NodeFS.rm(tmp, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    catch: (cause) => cause,
  });

const removePath = (target: string) =>
  Effect.tryPromise({
    try: () => NodeFS.rm(target, { recursive: true, force: true }),
    catch: (cause) => cause,
  });

export const make = Effect.fn("t3term.environmentCache.make")(function* () {
  // Remembers each thread row's encoding, so a save only encodes rows that changed.
  const encodeStoredShellSnapshot = makeStoredShellSnapshotEncoder();

  return Persistence.EnvironmentCacheStore.of({
    loadShell: (environmentId) =>
      readRecord(paths.shell(environmentId)).pipe(
        Effect.flatMap((raw) => {
          if (raw === null) return Effect.succeedNone;
          return decodeOrDiscardOrchestrationCache(
            decodeStoredShellSnapshot(raw).pipe(
              Effect.map((stored) =>
                stored.environmentId === environmentId ? Option.some(stored.snapshot) : Option.none(),
              ),
            ),
            removePath(paths.shell(environmentId)),
          );
        }),
        Effect.mapError((cause) => persistenceError("load-shell", cause)),
      ),
    saveShell: (environmentId, snapshot) =>
      encodeStoredShellSnapshot({
        schemaVersion: ORCHESTRATION_CACHE_SCHEMA_VERSION,
        environmentId,
        snapshot,
      }).pipe(
        Effect.flatMap((encoded) => writeRecord(paths.shell(environmentId), encoded)),
        Effect.mapError((cause) => persistenceError("save-shell", cause)),
      ),
    loadServerConfig: (environmentId) =>
      readRecord(paths.serverConfig(environmentId)).pipe(
        Effect.flatMap((raw) => {
          if (raw === null) return Effect.succeedNone;
          return decodeStoredServerConfig(raw).pipe(
            Effect.map((stored) => (stored.environmentId === environmentId ? Option.some(stored.config) : Option.none())),
          );
        }),
        Effect.mapError((cause) => persistenceError("load-server-config", cause)),
      ),
    saveServerConfig: (environmentId, config) =>
      encodeStoredServerConfig({ schemaVersion: 1, environmentId, config }).pipe(
        Effect.flatMap((encoded) => writeRecord(paths.serverConfig(environmentId), encoded)),
        Effect.mapError((cause) => persistenceError("save-server-config", cause)),
      ),
    loadThread: (environmentId, threadId) =>
      readRecord(paths.thread(environmentId, threadId)).pipe(
        Effect.flatMap((raw) => {
          if (raw === null) return Effect.succeedNone;
          return decodeOrDiscardOrchestrationCache(
            decodeStoredThreadSnapshot(raw).pipe(
              Effect.map((stored) =>
                stored.environmentId === environmentId && stored.threadId === threadId
                  ? Option.some(stored.snapshot)
                  : Option.none(),
              ),
            ),
            removePath(paths.thread(environmentId, threadId)),
          );
        }),
        Effect.mapError((cause) => persistenceError("load-thread", cause)),
      ),
    saveThread: (environmentId, snapshot) =>
      encodeStoredThreadSnapshot({
        schemaVersion: ORCHESTRATION_THREAD_CACHE_SCHEMA_VERSION,
        environmentId,
        threadId: snapshot.projection.thread.id,
        snapshot,
      }).pipe(
        Effect.flatMap((encoded) => writeRecord(paths.thread(environmentId, snapshot.projection.thread.id), encoded)),
        Effect.mapError((cause) => persistenceError("save-thread", cause)),
      ),
    removeThread: (environmentId, threadId) =>
      removePath(paths.thread(environmentId, threadId)).pipe(
        Effect.mapError((cause) => persistenceError("remove-thread", cause)),
      ),
    loadVcsRefs: (environmentId, cwd) =>
      readRecord(paths.vcsRefs(environmentId, cwd)).pipe(
        Effect.flatMap((raw) => {
          if (raw === null) return Effect.succeedNone;
          return decodeStoredVcsRefs(raw).pipe(
            Effect.map((stored) =>
              stored.environmentId === environmentId && stored.cwd === cwd ? Option.some(stored.refs) : Option.none(),
            ),
          );
        }),
        Effect.mapError((cause) => persistenceError("load-vcs-refs", cause)),
      ),
    saveVcsRefs: (environmentId, cwd, refs) =>
      encodeStoredVcsRefs({ schemaVersion: 1, environmentId, cwd, refs }).pipe(
        Effect.flatMap((encoded) => writeRecord(paths.vcsRefs(environmentId, cwd), encoded)),
        Effect.mapError((cause) => persistenceError("save-vcs-refs", cause)),
      ),
    removeVcsRefs: (environmentId, cwd) =>
      removePath(paths.vcsRefs(environmentId, cwd)).pipe(
        Effect.mapError((cause) => persistenceError("remove-vcs-refs", cause)),
      ),
    clearVcsRefs: (environmentId) =>
      removePath(paths.vcsRefsDir(environmentId)).pipe(
        Effect.mapError((cause) => persistenceError("clear-vcs-refs", cause)),
      ),
    clear: (environmentId) =>
      removePath(environmentDir(environmentId)).pipe(
        Effect.mapError((cause) => persistenceError("clear-environment", cause)),
      ),
  });
});

export const layer = Layer.effect(Persistence.EnvironmentCacheStore, make());
