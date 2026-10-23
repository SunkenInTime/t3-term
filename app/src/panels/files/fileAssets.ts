// Signed asset URLs for workspace images, wired like apps/web/src/state/assets.ts
// (createAssetEnvironmentAtoms) and read like apps/web/src/assets/assetUrls.ts
// (useAssetUrlState). t3-term has no local Electron media host, so there is no
// local-media fallback environment.
import { useAtomValue } from "@effect/atom-react";
import {
  EMPTY_ASSET_URL_ATOM,
  assetUrlStateFromResult,
  createAssetEnvironmentAtoms,
  type AssetUrlState,
} from "@t3tools/client-runtime/state/assets";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { connectionAtomRuntime } from "../../runtime/runtime.ts";
import { environmentSession } from "../../state/environment.ts";

export const fileAssetEnvironment = createAssetEnvironmentAtoms(connectionAtomRuntime);

export function useAssetUrlState(environmentId: EnvironmentId, resource: AssetResource | null): AssetUrlState {
  const prepared = useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId));
  const result = useAtomValue(
    resource === null
      ? EMPTY_ASSET_URL_ATOM
      : fileAssetEnvironment.createUrl({ environmentId, input: { resource } }),
  );
  const httpBaseUrl = Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
  return assetUrlStateFromResult(result as never, httpBaseUrl);
}
