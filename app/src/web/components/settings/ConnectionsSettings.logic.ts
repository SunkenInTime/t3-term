// Ported from apps/web/src/components/settings/ConnectionsSettings.logic.ts
// (parsePairingUrlFields, parseRemotePairingFields only). The rest of that file
// is desktop/SSH/advertised-endpoint logic a remote client does not use.
//
// Differences from web: `readHostedPairingRequest` and `getPairingTokenFromUrl`
// come from @t3tools/shared/remote (web re-exports the same functions), and a
// protocol-relative input resolves against http://localhost because there is
// no window.location.
import { getPairingTokenFromUrl, readHostedPairingRequest } from "@t3tools/shared/remote";

const NO_WINDOW_ORIGIN = "http://localhost";

export function parsePairingUrlFields(
  input: string,
): { readonly host: string; readonly pairingCode: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const urlLikeInput =
      /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//u.test(trimmed) || trimmed.startsWith("//")
        ? trimmed
        : `https://${trimmed}`;
    const url = new URL(urlLikeInput, NO_WINDOW_ORIGIN);
    const hostedPairingRequest = readHostedPairingRequest(url);
    if (hostedPairingRequest) {
      return {
        host: hostedPairingRequest.host,
        pairingCode: hostedPairingRequest.token,
      };
    }

    const pairingCode = getPairingTokenFromUrl(url);
    if (!pairingCode) return null;
    return {
      host: url.origin,
      pairingCode,
    };
  } catch {
    return null;
  }
}

export function parseRemotePairingFields(input: {
  readonly host: string;
  readonly pairingCode: string;
}): {
  readonly host: string;
  readonly pairingCode: string;
} {
  const parsedPairingUrl = parsePairingUrlFields(input.host);
  if (parsedPairingUrl) return parsedPairingUrl;

  const host = input.host.trim();
  const pairingCode = input.pairingCode.trim();
  if (!host) {
    throw new Error("Enter a backend host.");
  }
  if (!pairingCode) {
    throw new Error("Enter a pairing code.");
  }
  return { host, pairingCode };
}
