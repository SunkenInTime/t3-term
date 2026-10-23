// The third-party license manifest the Open source licenses page lists. The web
// app fetches /third-party-licenses.json, which its Vite plugin generates from
// the web, server and desktop package manifests. t3-term runs from source, so
// it generates its own manifest the same way the web's dev server does: T3's
// generator (vendor/t3code/scripts/lib/third-party-licenses.ts) over
// app/package.json, once per run, with overrides for the few dependencies
// that ship without a license file (./third-party-licenses.config.json).
import * as NodeURL from "node:url";

import { decodeThirdPartyLicenseManifest, type ThirdPartyLicenseManifest } from "@t3tools/shared/thirdPartyLicenses";

interface GeneratorModule {
  readonly generateThirdPartyLicenseManifest: (input: {
    readonly configFile?: string;
    readonly packageManifests: ReadonlyArray<{ readonly bundle: string; readonly path: string }>;
    readonly bundleName?: string;
    readonly allowMissingGeneratedNotices?: boolean;
  }) => Promise<unknown>;
}

/** The bundle every t3-term entry is listed under. */
const BUNDLE = "t3-term";

const appPackageJson = NodeURL.fileURLToPath(new URL("../../../package.json", import.meta.url));
const configFile = NodeURL.fileURLToPath(new URL("./third-party-licenses.config.json", import.meta.url));
// A computed specifier keeps tsc out of the generator, whose Vite plugin types t3-term doesn't install.
const generatorUrl = new URL("../../../../vendor/t3code/scripts/lib/third-party-licenses.ts", import.meta.url).href;

let manifestPromise: Promise<ThirdPartyLicenseManifest> | undefined;

async function generateManifest(): Promise<ThirdPartyLicenseManifest> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The license manifest took too long to load.")), 30_000);
  });
  try {
    const generator = (await import(generatorUrl)) as GeneratorModule;
    const manifest = await Promise.race([
      generator.generateThirdPartyLicenseManifest({
        packageManifests: [{ bundle: BUNDLE, path: appPackageJson }],
        bundleName: BUNDLE,
        configFile,
        allowMissingGeneratedNotices: true,
      }),
      timeout,
    ]);
    return decodeThirdPartyLicenseManifest(manifest);
  } finally {
    clearTimeout(timer);
  }
}

/** loadLicenseManifest: one generation per run; a failure clears the cache so Try again retries. */
export function loadLicenseManifest(): Promise<ThirdPartyLicenseManifest> {
  manifestPromise ??= generateManifest().catch((error: unknown) => {
    manifestPromise = undefined;
    throw error;
  });
  return manifestPromise;
}
