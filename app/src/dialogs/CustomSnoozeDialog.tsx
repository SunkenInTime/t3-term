// Port of apps/web/src/components/CustomSnoozeDialog.tsx. Web's native
// <input type="time">, day-picker calendar and Base UI number field have no
// gpuix counterpart; they are rebuilt here from the ui kit.
import { useAtomValue } from "@effect/atom-react";
import {
  localSnoozeDate,
  resolveCustomSnooze,
  type CustomSnoozeInput,
} from "@t3tools/client-runtime/state/thread-settled";
import { Atom } from "effect/reactivity";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { useEffect, useRef, useState } from "react";

import { appAtomRegistry } from "../runtime/runtime.ts";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuItem, Popover } from "../ui/overlay.tsx";
import { Button, Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { Calendar } from "./Calendar.tsx";
import {
  DIALOG_WIDTH,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogShell,
  ErrorLine,
  FieldFrame,
  FieldLabel,
  SegmentedToggle,
  TextField,
} from "./dialogKit.tsx";

type SnoozeChoice = { readonly snoozedUntil: string };
type Request = { readonly resolve: (choice: SnoozeChoice | null) => void };

const requestAtom = Atom.make<Request | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs:custom-snooze-request"),
);

/**
 * Opens "Custom snooze". Resolves with the chosen wake time (ISO string), or
 * null on Cancel/Escape. A second request cancels the first.
 */
export function requestCustomSnooze(): Promise<SnoozeChoice | null> {
  appAtomRegistry.get(requestAtom)?.resolve(null);
  return new Promise((resolve) => appAtomRegistry.set(requestAtom, { resolve }));
}

function finish(choice: SnoozeChoice | null) {
  const request = appAtomRegistry.get(requestAtom);
  appAtomRegistry.set(requestAtom, null);
  request?.resolve(choice);
}

export function CustomSnoozeDialogHost() {
  const request = useAtomValue(requestAtom);
  useEffect(() => () => finish(null), []);
  return request ? <CustomSnoozeDialog /> : null;
}

type Unit = "minutes" | "hours" | "days";
const UNIT_LABELS: Record<Unit, string> = { minutes: "Minutes", hours: "Hours", days: "Days" };

/** What a browser's time input shows: the locale's hour cycle, two-digit hours. */
function displayTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Reads "15:30", "3:30 pm" or "03:30 PM" back into the HH:MM resolveCustomSnooze takes. */
function parseTime(value: string): string {
  const match = /^\s*(\d{1,2})[:.](\d{2})\s*([ap])?\.?\s*m?\.?\s*$/i.exec(value);
  if (!match) return value.trim();
  let hours = Number(match[1]);
  const minutes = match[2]!;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return value.trim();
    hours = (hours % 12) + (meridiem === "p" ? 12 : 0);
  }
  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

function CustomSnoozeDialog() {
  const theme = useTheme();
  const [initial] = useState(() => new Date(Date.now() + 3_600_000));
  const [mode, setMode] = useState<CustomSnoozeInput["mode"]>("date");
  const [date, setDate] = useState(initial);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [time, setTime] = useState(() => displayTime(initial));
  const [amount, setAmount] = useState("2");
  const [unit, setUnit] = useState<Unit>("hours");
  const [error, setError] = useState<string | null>(null);
  const input: CustomSnoozeInput =
    mode === "date"
      ? { mode, date: localSnoozeDate(date), time: parseTime(time) }
      : { mode, amount, unit };

  const submit = () => {
    const snoozedUntil = resolveCustomSnooze(input, new Date());
    if (!snoozedUntil) {
      setError(
        mode === "date" ? "Choose a valid date and time in the future." : "Enter a positive duration.",
      );
      return;
    }
    finish({ snoozedUntil });
  };

  const stepAmount = (delta: number) => {
    const current = Number(amount);
    const base = Number.isFinite(current) ? current : 0;
    setAmount(String(Math.max(0, base + delta)));
    setError(null);
  };

  return (
    <DialogShell
      width={DIALOG_WIDTH.sm}
      testId="custom-snooze-dialog"
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogHeader
        title="Custom snooze"
        description="Choose when snoozed threads return to your inbox."
        hasPanel
      />
      <DialogPanel>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SegmentedToggle
            fill
            testId="snooze-mode"
            value={mode}
            options={[
              { value: "date", label: "Date and time" },
              { value: "duration", label: "Duration" },
            ]}
            onChange={(next) => {
              setMode(next);
              setError(null);
            }}
          />
          {mode === "date" ? (
            <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                <FieldLabel>Date</FieldLabel>
                <Popover
                  open={calendarOpen}
                  onOpenChange={setCalendarOpen}
                  align="start"
                  testId="snooze-calendar-popover"
                  style={{ padding: 8, borderRadius: RADIUS.xl }}
                  rootStyle={{ alignItems: "stretch" }}
                  trigger={
                    <Button
                      variant="outline"
                      testId="snooze-date"
                      trailingIcon="calendar"
                      onClick={() => setCalendarOpen(!calendarOpen)}
                      style={{ flexGrow: 1, justifyContent: "space-between", borderRadius: RADIUS.lg }}
                    >
                      {date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </Button>
                  }
                >
                  <Calendar
                    testId="snooze-calendar"
                    selected={date}
                    disabledBefore={new Date()}
                    onSelect={(selected) => {
                      setDate(selected);
                      setCalendarOpen(false);
                      setError(null);
                    }}
                  />
                </Popover>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                <FieldLabel>Time</FieldLabel>
                <TextField
                  testId="snooze-time"
                  value={time}
                  onChange={(value) => {
                    setTime(value);
                    setError(null);
                  }}
                  onSubmit={submit}
                  trailing={
                    <div style={{ paddingRight: 8 }}>
                      <Icon name="clock" size={14} color={theme.foreground} opacity={0.8} />
                    </div>
                  }
                />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                <FieldLabel>Snooze for</FieldLabel>
                <NumberField
                  value={amount}
                  onChange={(value) => {
                    setAmount(value);
                    setError(null);
                  }}
                  onStep={stepAmount}
                  onSubmit={submit}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                <FieldLabel>Unit</FieldLabel>
                <UnitSelect
                  value={unit}
                  onChange={(next) => {
                    setUnit(next);
                    setError(null);
                  }}
                />
              </div>
            </div>
          )}
        </div>
        {error ? <ErrorLine size="sm">{error}</ErrorLine> : null}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" testId="snooze-cancel" onClick={() => finish(null)}>
          Cancel
        </Button>
        <Button testId="snooze-submit" onClick={submit}>
          Snooze
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}

/** apps/web/src/components/ui/number-field.tsx: [−] centered value [+] in one input frame. */
function NumberField({
  value,
  onChange,
  onStep,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onStep: (delta: number) => void;
  onSubmit: () => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const renderer = useGpuixRequired();
  const inputRef = useRef<PublicInstance | null>(null);
  const stepButton = (icon: "minus" | "plus", delta: number, side: "left" | "right") => (
    <div
      testId={icon === "minus" ? "snooze-amount-decrement" : "snooze-amount-increment"}
      onClick={() => onStep(delta)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "stretch",
        width: 34,
        flexShrink: 0,
        cursor: "pointer",
        ...(side === "left"
          ? { borderTopLeftRadius: RADIUS.lg - 4, borderBottomLeftRadius: RADIUS.lg - 4 }
          : { borderTopRightRadius: RADIUS.lg - 4, borderBottomRightRadius: RADIUS.lg - 4 }),
        hover: { backgroundColor: theme.accent },
      }}
    >
      <Icon name={icon} size={16} color={theme.foreground} />
    </div>
  );
  return (
    <FieldFrame focused={focused}>
      {stepButton("minus", -1, "left")}
      {/* A gpuix input cannot center its text, so the input is sized to its
          digits and centered in the slot; a click on the slot focuses it. */}
      <div
        onClick={() => {
          if (inputRef.current) renderer.focusElement?.(inputRef.current.id);
        }}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          alignSelf: "stretch",
          flexGrow: 1,
          minWidth: 0,
          cursor: "text",
        }}
      >
        <input
          ref={inputRef}
          testId="snooze-amount"
          value={value}
          theme={{ caret: theme.foreground }}
          onChange={(event) => onChange(String(event.value ?? "").replace(/[^\d.]/g, ""))}
          onSubmit={() => onSubmit()}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: Math.max(10, value.length * 8 + 2),
            maxWidth: "100%",
            height: 24,
            fontSize: 14,
            color: theme.foreground,
          }}
        />
      </div>
      {stepButton("plus", 1, "right")}
    </FieldFrame>
  );
}

/** apps/web/src/components/ui/select.tsx trigger at full width: chevron 12px at 50%. */
function UnitSelect({ value, onChange }: { value: Unit; onChange: (value: Unit) => void }) {
  const theme = useTheme();
  return (
    <Menu
      align="start"
      minWidth={160}
      testId="snooze-unit-menu"
      rootStyle={{ alignItems: "stretch" }}
      trigger={({ toggle }) => (
        <FieldFrame focused={false} testId="snooze-unit" onClick={toggle} style={{ flexGrow: 1, cursor: "pointer" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              flexGrow: 1,
              paddingLeft: 8,
              paddingRight: 8,
            }}
          >
            <Text>{UNIT_LABELS[value]}</Text>
            <Icon name="chevron-down" size={12} color={alpha(theme.mutedForeground, 0.5)} />
          </div>
        </FieldFrame>
      )}
    >
      {(Object.keys(UNIT_LABELS) as Unit[]).map((option) => (
        <MenuItem key={option} testId={`snooze-unit-${option}`} checked={option === value} onSelect={() => onChange(option)}>
          {UNIT_LABELS[option]}
        </MenuItem>
      ))}
    </Menu>
  );
}
