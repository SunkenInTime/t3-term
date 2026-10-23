// The provider the composer has resolved for its target, published for the banner lane
// above the timeline (web ChatView computes `activeProviderStatus` once and hands it to
// both ChatComposer and ChatBannerLane; here the composer owns the resolution).
import type { ServerProvider } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

export const composerProviderStatusAtom = Atom.family((_composerTargetKey: string) =>
  Atom.make<ServerProvider | null>(null).pipe(Atom.keepAlive),
);

/** web ChatView `dismissedProviderStatusBannerKey`: cleared once the provider recovers. */
export const dismissedProviderStatusBannerKeyAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
