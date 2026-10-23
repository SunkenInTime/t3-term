import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

import {
  ConnectionCatalogDocument,
  type ConnectionCatalogDocument as ConnectionCatalogDocumentType,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "@t3tools/client-runtime/platform";
import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { termHome } from "./paths.ts";

function catalogError(operation: string, cause: unknown) {
  return new ConnectionTransientError({
    reason: "remote-unavailable",
    detail: `Could not ${operation} the local connection catalog: ${String(cause)}`,
  });
}

const CatalogJson = Schema.fromJsonString(ConnectionCatalogDocument);
const decodeCatalog = Schema.decodeEffect(CatalogJson);
const encodeCatalog = Schema.encodeEffect(CatalogJson);

export interface CatalogStore {
  readonly read: Effect.Effect<ConnectionCatalogDocumentType, ConnectionTransientError>;
  readonly update: (
    transform: (catalog: ConnectionCatalogDocumentType) => ConnectionCatalogDocumentType,
  ) => Effect.Effect<void, ConnectionTransientError>;
}

/** The connection catalog as one JSON file, the file-backed twin of mobile's secure-store catalog. */
export const make = Effect.fn("t3term.catalogStore.make")(function* () {
  const file = NodePath.join(termHome(), "connection-catalog.json");
  const state = yield* Ref.make<Option.Option<ConnectionCatalogDocumentType>>(Option.none());
  const lock = yield* Semaphore.make(1);

  const loadUnlocked = Effect.gen(function* () {
    const cached = yield* Ref.get(state);
    if (Option.isSome(cached)) return cached.value;
    const raw = yield* Effect.promise(() => NodeFS.readFile(file, "utf8").catch(() => null));
    const catalog =
      raw === null || raw.trim() === ""
        ? EMPTY_CONNECTION_CATALOG_DOCUMENT
        : yield* decodeCatalog(raw).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Discarding corrupt connection catalog", error).pipe(
                Effect.as(EMPTY_CONNECTION_CATALOG_DOCUMENT),
              ),
            ),
          );
    yield* Ref.set(state, Option.some(catalog));
    return catalog;
  });

  const read = lock.withPermits(1)(loadUnlocked);
  const update: CatalogStore["update"] = (transform) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const next = transform(yield* loadUnlocked);
        const encoded = yield* encodeCatalog(next).pipe(
          Effect.mapError((cause) => catalogError("encode", cause)),
        );
        yield* Effect.tryPromise({
          try: async () => {
            await NodeFS.mkdir(NodePath.dirname(file), { recursive: true });
            const tmp = `${file}.${process.pid}.tmp`;
            await NodeFS.writeFile(tmp, encoded, { mode: 0o600 });
            await NodeFS.rename(tmp, file);
          },
          catch: (cause) => catalogError("save", cause),
        });
        yield* Ref.set(state, Option.some(next));
      }),
    );

  return { read, update } satisfies CatalogStore;
});
