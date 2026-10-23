// The screen t3-term shows instead of the app shell while no environment is
// saved. Web has no single page for this, so it is assembled from web parts:
//   - the card and header of the /pair route (components/auth/PairingRouteSurface.tsx
//     on ui/standalone-page.tsx), including its inline error alert;
//   - title and description from HostedEmptyState.tsx, the hosted client's
//     screen for "no computer added yet", which is the state t3-term is in;
//   - the Host / Pairing code fields and URL auto-fill from
//     settings/AddEnvironmentDialog.tsx, the client-side way to pair a remote;
//   - the "Need a pairing link?" help from onboarding/WelcomeWizard.tsx.
// Pairing saves the environment in the catalog, which flips the gate in App.
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { Button, Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";
import {
  parsePairingUrlFields,
  parseRemotePairingFields,
} from "../web/components/settings/ConnectionsSettings.logic.ts";
import { registerPairing } from "./bootstrap.ts";
import {
  CommandLine,
  ErrorAlert,
  StandalonePage,
  StandalonePageHeader,
  TextField,
} from "./StandalonePage.tsx";

export function ConnectScreen({ initialError }: { readonly initialError: string | null }) {
  const theme = useTheme();
  const [host, setHost] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [errorMessage, setErrorMessage] = useState(initialError ?? "");
  const [isPairing, setIsPairing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // gpuix inputs keep their own text and only take `value` when the prop
  // changes. Typing past "#token=" re-parses to the same host every keystroke,
  // so the prop stops changing while the field keeps the full URL. Remounting
  // the field on auto-fill puts the parsed host back in it.
  const [hostFieldRevision, setHostFieldRevision] = useState(0);

  // AddEnvironmentDialog.handleSavedBackendHostChange: a pasted pairing URL fills both fields.
  const handleHostChange = (value: string) => {
    const parsedPairingUrl = parsePairingUrlFields(value);
    if (parsedPairingUrl) {
      setHost(parsedPairingUrl.host);
      setPairingCode(parsedPairingUrl.pairingCode);
      if (parsedPairingUrl.host !== value) setHostFieldRevision((revision) => revision + 1);
      return;
    }
    setHost(value);
  };

  const submit = async () => {
    if (isPairing) return;
    let input: ReturnType<typeof parseRemotePairingFields>;
    try {
      input = parseRemotePairingFields({ host, pairingCode });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Pairing failed.");
      return;
    }
    setIsPairing(true);
    setErrorMessage("");
    const result = await runAtomCommand(appAtomRegistry, registerPairing, input);
    // Success saves the environment, and App swaps this screen for the shell.
    if (!mountedRef.current) return;
    setIsPairing(false);
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    const cause = squashAtomCommandFailure(result);
    setErrorMessage(cause instanceof Error ? cause.message : "Pairing failed.");
  };

  return (
    <StandalonePage>
      <StandalonePageHeader
        eyebrow="T3 Code"
        title="No computer connected"
        description="Your agents run on your computer. Start T3 Code there first."
      />

      <div style={{ display: "flex", flexDirection: "column", marginTop: 24 }}>
        <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
          <TextField
            key={hostFieldRevision}
            autoFocus
            label="Host"
            value={host}
            placeholder="backend.example.com"
            disabled={isPairing}
            onChange={handleHostChange}
            onSubmit={() => void submit()}
            testId="connect-host"
            style={{ flexGrow: 1, flexBasis: 0 }}
          />
          <TextField
            label="Pairing code"
            value={pairingCode}
            placeholder="PAIRCODE"
            disabled={isPairing}
            onChange={setPairingCode}
            onSubmit={() => void submit()}
            testId="connect-pairing-code"
            style={{ width: 160, flexShrink: 0 }}
          />
        </div>
        <Text size="2xs" color={theme.mutedForeground} style={{ marginTop: 16 }}>
          Paste a full pairing URL here to fill both fields automatically.
        </Text>

        {errorMessage ? (
          <ErrorAlert style={{ marginTop: 16 }}>{errorMessage}</ErrorAlert>
        ) : null}

        <div style={{ display: "flex", flexDirection: "row", gap: 8, marginTop: 16 }}>
          <Button size="sm" disabled={isPairing} onClick={() => void submit()} testId="connect-submit">
            {isPairing ? "Pairing..." : "Pair"}
          </Button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: 24,
          paddingTop: 12,
          paddingBottom: 12,
          paddingLeft: 12,
          paddingRight: 12,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: alpha(theme.border, 0.7),
          backgroundColor: alpha(theme.background, 0.55),
        }}
      >
        <Text size="xs" color={theme.mutedForeground} style={{ lineHeight: 19.5 }}>
          Run this on the computer with your code.
        </Text>
        <CommandLine command="npx t3 pair" style={{ marginTop: 8 }} />
        <Text size="xs" color={theme.mutedForeground} style={{ marginTop: 8, lineHeight: 19.5 }}>
          Start T3 Code first, or run npx t3 serve. Add --tailscale to use your tailnet.
        </Text>
      </div>
    </StandalonePage>
  );
}
