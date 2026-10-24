// apps/web/src/components/chat/SecretRequestCard.tsx PendingSecretRequestForm:
// the agent's request for a secret, answered in place. The field masks what is
// typed while keeping ordinary text editing (ui/MaskedInput.tsx), and the
// answer command never logs its failure, because the cause carries the request.
import {
  SECRET_REQUEST_DEFAULT_PLACEHOLDER,
  SECRET_REQUEST_PRIVACY_NOTE,
  secretRequestAnswerInput,
  secretRequestFailureMessage,
  type SecretRequestItem,
} from "@t3tools/client-runtime/secret-request";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useRef, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { serverEnvironment } from "../state/environment.ts";
import { Icon } from "../ui/Icon.tsx";
import { MaskedInput } from "../ui/MaskedInput.tsx";
import { Button, Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";

export function PendingSecretRequestForm(props: { readonly environmentId: EnvironmentId; readonly item: SecretRequestItem }) {
  const theme = useTheme();
  const { item } = props;
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter then a click can both run before a re-render; this guard is synchronous.
  const inFlight = useRef(false);

  const send = async (reply: { readonly type: "save"; readonly secret: string } | { readonly type: "decline" }) => {
    const input = secretRequestAnswerInput(item, reply);
    if (input === null || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.answerSecretRequest,
      { environmentId: props.environmentId, input },
      // The failure cause holds the request; keep it out of the console.
      { label: "answer secret request", reportFailure: false, reportDefect: false },
    ).finally(() => {
      inFlight.current = false;
      setSubmitting(false);
    });
    if (result._tag === "Success") {
      setSecret("");
      return;
    }
    if (!isAtomCommandInterrupted(result)) setError(secretRequestFailureMessage(squashAtomCommandFailure(result)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, padding: 16, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: alpha(theme.border, 0.6), backgroundColor: theme.card }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <Text size="sm" weight={500}>
          {item.label}
        </Text>
        {item.reason.trim() ? (
          <Text size="sm" color={theme.mutedForeground}>
            {item.reason}
          </Text>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 0, height: 32, alignItems: "center", paddingLeft: 10, paddingRight: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: error !== null ? alpha(theme.error, 0.36) : theme.input, backgroundColor: theme.appearance === "dark" ? "#ffffff05" : theme.popover }}>
          <MaskedInput
            testId={`secret-input-${item.id}`}
            value={secret}
            height={30}
            placeholder={item.placeholder ?? SECRET_REQUEST_DEFAULT_PLACEHOLDER}
            readOnly={submitting}
            onChange={setSecret}
            onSubmit={(value) => void send({ type: "save", secret: value })}
          />
        </div>
        <Button disabled={submitting || secret.trim().length === 0} onClick={() => void send({ type: "save", secret })}>
          Save securely
        </Button>
      </div>
      {error !== null ? (
        <Text size="xs" color={theme.errorForeground}>
          {error}
        </Text>
      ) : null}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Icon name="shield-check" size={14} color={theme.mutedForeground} />
          <Text size="xs" color={theme.mutedForeground} truncate>
            {SECRET_REQUEST_PRIVACY_NOTE}
          </Text>
        </div>
        <Button size="xs" variant="ghost-muted" disabled={submitting} onClick={() => void send({ type: "decline" })}>
          Decline
        </Button>
      </div>
    </div>
  );
}
