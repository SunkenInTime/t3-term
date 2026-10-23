// Hosts for the sidebar's dialog requests (dialogRequests.ts):
// apps/web/src/components/ConfirmDialogHost.tsx and CustomSnoozeDialog.tsx.
import { useAtomValue } from "@effect/atom-react";
import {
  localSnoozeDate,
  localSnoozeTime,
  resolveCustomSnooze,
  type CustomSnoozeInput,
} from "@t3tools/client-runtime/state/thread-settled";
import { useState } from "react";

import { Icon } from "../ui/Icon.tsx";
import { Dialog, Popover, Select } from "../ui/overlay.tsx";
import { Button, IconButton, Text } from "../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../ui/theme.ts";
import {
  confirmRequestAtom,
  customSnoozeRequestAtom,
  resolveConfirmDialogCopy,
} from "./dialogRequests.ts";

export function SidebarDialogs() {
  return (
    <>
      <ConfirmDialogHost />
      <CustomSnoozeDialogHost />
    </>
  );
}

function ConfirmDialogHost() {
  const request = useAtomValue(confirmRequestAtom);
  const theme = useTheme();
  if (!request) return null;
  const copy = resolveConfirmDialogCopy(request.message);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) request.resolve(false);
      }}
      width={448}
      testId="sidebar-confirm-dialog"
      footer={
        <>
          <Button variant="outline" testId="sidebar-confirm-cancel" onClick={() => request.resolve(false)}>
            Cancel
          </Button>
          <Button
            variant={request.variant === "destructive" ? "destructive" : "default"}
            testId="sidebar-confirm-accept"
            onClick={() => request.resolve(true)}
          >
            Confirm
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 24 }}>
        <Text size="lg" weight={600}>
          {copy.title}
        </Text>
        {copy.description
          ? copy.description.split("\n").map((line, index) => (
              <Text key={index} color={theme.mutedForeground}>
                {line}
              </Text>
            ))
          : null}
      </div>
    </Dialog>
  );
}

function CustomSnoozeDialogHost() {
  const request = useAtomValue(customSnoozeRequestAtom);
  return request ? <CustomSnoozeDialog resolve={request.resolve} /> : null;
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text size="sm" weight={500}>
      {children}
    </Text>
  );
}

const fieldStyle = (theme: ReturnType<typeof useTheme>) => ({
  display: "flex" as const,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  height: 32,
  paddingLeft: 10,
  paddingRight: 10,
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: theme.input,
  backgroundColor: alpha(theme.input, 0.32),
});

function CustomSnoozeDialog({ resolve }: { resolve: (choice: { snoozedUntil: string } | null) => void }) {
  const theme = useTheme();
  const [initial] = useState(() => new Date(Date.now() + 3_600_000));
  const [mode, setMode] = useState<CustomSnoozeInput["mode"]>("date");
  const [date, setDate] = useState(initial);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [time, setTime] = useState(localSnoozeTime(initial));
  const [amount, setAmount] = useState("2");
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [error, setError] = useState<string | null>(null);
  const input: CustomSnoozeInput =
    mode === "date" ? { mode, date: localSnoozeDate(date), time } : { mode, amount, unit };
  const submit = () => {
    const snoozedUntil = resolveCustomSnooze(input, new Date());
    if (!snoozedUntil) {
      setError(mode === "date" ? "Choose a valid date and time in the future." : "Enter a positive duration.");
      return;
    }
    resolve({ snoozedUntil });
  };
  const toggle = (value: CustomSnoozeInput["mode"], label: string) => (
    <div
      testId={`custom-snooze-mode-${value}`}
      onClick={() => {
        setMode(value);
        setError(null);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexGrow: 1,
        flexBasis: 0,
        height: 28,
        borderRadius: RADIUS.lg,
        cursor: "pointer",
        backgroundColor: mode === value ? theme.accent : "#00000000",
        hover: { backgroundColor: theme.accent },
      }}
    >
      <Text weight={500} color={mode === value ? theme.foreground : theme.mutedForeground}>
        {label}
      </Text>
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) resolve(null);
      }}
      width={384}
      title="Custom snooze"
      description="Choose when snoozed threads return to your inbox."
      testId="custom-snooze-dialog"
      footer={
        <>
          <Button variant="outline" onClick={() => resolve(null)}>
            Cancel
          </Button>
          <Button testId="custom-snooze-submit" onClick={submit}>
            Snooze
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "row", gap: 4, padding: 2, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.input }}>
          {toggle("date", "Date and time")}
          {toggle("duration", "Duration")}
        </div>
        {mode === "date" ? (
          <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
              <FieldLabel>Date</FieldLabel>
              <Popover
                open={calendarOpen}
                onOpenChange={setCalendarOpen}
                align="start"
                rootStyle={{ flexDirection: "column", alignItems: "stretch" }}
                trigger={
                  <div
                    testId="custom-snooze-date"
                    onClick={() => setCalendarOpen(!calendarOpen)}
                    style={{ ...fieldStyle(theme), justifyContent: "space-between", cursor: "pointer" }}
                  >
                    <Text>
                      {date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </Text>
                    <Icon name="calendar" size={16} color={theme.mutedForeground} />
                  </div>
                }
                style={{ padding: 8 }}
              >
                <Calendar
                  selected={date}
                  onSelect={(selected) => {
                    setDate(selected);
                    setCalendarOpen(false);
                    setError(null);
                  }}
                />
              </Popover>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
              <FieldLabel>Time</FieldLabel>
              <div style={fieldStyle(theme)}>
                <input
                  testId="custom-snooze-time"
                  value={time}
                  placeholder="HH:MM"
                  onChange={(event) => {
                    setTime(event.value ?? "");
                    setError(null);
                  }}
                  onSubmit={submit}
                  style={{ flexGrow: 1, minWidth: 0, fontSize: 14, fontFamily: FONTS.sans, color: theme.foreground }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
              <FieldLabel>Snooze for</FieldLabel>
              <div style={{ ...fieldStyle(theme), paddingLeft: 2, paddingRight: 2, gap: 2 }}>
                <IconButton
                  icon="minus"
                  size={26}
                  iconSize={14}
                  onClick={() => setAmount((value) => String(Math.max(0, (Number(value) || 0) - 1)))}
                />
                <input
                  testId="custom-snooze-amount"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.value ?? "");
                    setError(null);
                  }}
                  onSubmit={submit}
                  style={{ flexGrow: 1, minWidth: 0, fontSize: 14, fontFamily: FONTS.sans, color: theme.foreground, textAlign: "center" }}
                />
                <IconButton
                  icon="plus"
                  size={26}
                  iconSize={14}
                  onClick={() => setAmount((value) => String((Number(value) || 0) + 1))}
                />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
              <FieldLabel>Unit</FieldLabel>
              <Select
                value={unit}
                minWidth={0}
                align="start"
                options={[
                  { value: "minutes", label: "Minutes" },
                  { value: "hours", label: "Hours" },
                  { value: "days", label: "Days" },
                ]}
                onChange={(value) => {
                  setUnit(value);
                  setError(null);
                }}
              />
            </div>
          </div>
        )}
        {error ? <Text color={theme.errorForeground}>{error}</Text> : null}
      </div>
    </Dialog>
  );
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** ui/calendar.tsx (react-day-picker) reduced to a single-date month grid; past days are disabled. */
function Calendar({ selected, onSelect }: { selected: Date; onSelect: (date: Date) => void }) {
  const theme = useTheme();
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: Array<Date | null> = [];
  for (let index = 0; index < first.getDay(); index++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(month.getFullYear(), month.getMonth(), day));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<Date | null>> = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 32 }}>
        <IconButton icon="chevron-left" size={28} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
        <Text weight={500}>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</Text>
        <IconButton icon="chevron-right" size={28} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} />
      </div>
      <div style={{ display: "flex", flexDirection: "row" }}>
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} style={{ display: "flex", width: 32, height: 28, alignItems: "center", justifyContent: "center" }}>
            <Text size="xs" color={theme.mutedForeground}>
              {weekday}
            </Text>
          </div>
        ))}
      </div>
      {weeks.map((week, row) => (
        <div key={row} style={{ display: "flex", flexDirection: "row" }}>
          {week.map((day, column) => {
            if (day === null) return <div key={column} style={{ width: 32, height: 32 }} />;
            const disabled = day < today;
            const isSelected = sameDay(day, selected);
            return (
              <div
                key={column}
                onClick={
                  disabled
                    ? undefined
                    : () => {
                        // Keep the chosen time-of-day; only the calendar day changes.
                        const next = new Date(selected);
                        next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
                        onSelect(next);
                      }
                }
                style={{
                  display: "flex",
                  width: 32,
                  height: 32,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: RADIUS.md,
                  cursor: disabled ? "default" : "pointer",
                  backgroundColor: isSelected ? theme.primary : "#00000000",
                  ...(disabled || isSelected ? {} : { hover: { backgroundColor: theme.accent } }),
                }}
              >
                <Text color={isSelected ? theme.primaryForeground : disabled ? alpha(theme.mutedForeground, 0.5) : theme.foreground}>
                  {String(day.getDate())}
                </Text>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
