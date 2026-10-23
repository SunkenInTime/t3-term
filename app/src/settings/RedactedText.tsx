// apps/web/src/components/settings/RedactedSensitiveText.tsx. GPUI has no
// blur filter, so the hidden state shows a deterministic look-alike string in
// a faint color instead of a blurred real value.
import { useState } from "react";

import { Tooltip } from "../ui/overlay.tsx";
import { Text } from "../ui/primitives.tsx";
import { alpha, useTheme } from "../ui/theme.ts";

const REDACTED_TEXT_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function redactedPlaceholder(value: string): string {
  let state = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  const nextChar = () => {
    state = Math.imul(state ^ (state >>> 13), 0x85ebca6b);
    state = Math.imul(state ^ (state >>> 16), 0xc2b2ae35);
    return REDACTED_TEXT_ALPHABET[Math.abs(state) % REDACTED_TEXT_ALPHABET.length] ?? "x";
  };
  return Array.from(value, (char) => (char === "@" || char === "." || char === "-" || char === "_" ? char : nextChar())).join("");
}

/** A login or email that stays hidden until clicked. */
export function RedactedText({
  value,
  revealTooltip = "Click to reveal",
  hideTooltip = "Click to hide",
  revealed: controlled,
}: {
  value: string | null | undefined;
  revealTooltip?: string;
  hideTooltip?: string;
  /** Controlled reveal (no click toggle) when set. */
  revealed?: boolean;
}) {
  const theme = useTheme();
  const [own, setOwn] = useState(false);
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const revealed = controlled ?? own;
  const text = (
    <Text size="2xs" mono color={revealed ? theme.mutedForeground : alpha(theme.mutedForeground, 0.35)} truncate>
      {revealed ? trimmed : redactedPlaceholder(trimmed)}
    </Text>
  );
  if (controlled !== undefined) return text;
  return (
    <Tooltip content={revealed ? hideTooltip : revealTooltip} side="top">
      <div onClick={() => setOwn(!own)} style={{ display: "flex", cursor: "pointer", minWidth: 0 }}>
        {text}
      </div>
    </Tooltip>
  );
}
