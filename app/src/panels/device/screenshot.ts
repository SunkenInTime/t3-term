// Copy of packages/client-runtime/src/device/screenshot.ts. That module types its
// target with stream.ts, whose WebCodecs code does not typecheck against Bun.
import { type DeviceHubAccess, withDeviceHubQuery } from "@t3tools/client-runtime/device/hub-access";
import type { DevicePlatform } from "@t3tools/contracts";

export class DeviceScreenshotError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Screenshot capture failed (${status}). Try again.`);
    this.status = status;
  }
}

export async function captureDeviceScreenshot(
  target: { readonly access: DeviceHubAccess; readonly platform: DevicePlatform; readonly deviceId: string },
  signal: AbortSignal,
) {
  const vendor = target.platform === "ios" ? "serve-sim" : "serve-emu";
  const url = withDeviceHubQuery(
    `${target.access.httpBase}/vendor/${vendor}/api/screenshot?device=${encodeURIComponent(target.deviceId)}`,
    target.access,
  );
  const response = await fetch(url, { method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
  if (!response.ok) throw new DeviceScreenshotError(response.status);
  const image = await response.blob();
  if (!image.size) throw new Error("The device returned an empty screenshot. Try again.");
  return image;
}
