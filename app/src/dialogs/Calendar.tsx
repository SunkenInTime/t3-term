// Month calendar after apps/web/src/components/ui/calendar.tsx (react-day-picker
// with T3's class names): 36px cells, nav chevrons beside the caption, outside
// days shown, disabled days struck through, today marked by a 3px dot.
import { useState } from "react";

import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";

const CELL = 36;

type LocaleWithWeekInfo = Intl.Locale & {
  readonly weekInfo?: { readonly firstDay: number };
  getWeekInfo?: () => { readonly firstDay: number };
};

/** apps/web/src/timestampFormat.ts resolveWeekStartsOn: 0 is Sunday; week info counts Sunday as 7. */
function resolveWeekStartsOn(): number {
  try {
    const resolved: LocaleWithWeekInfo = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale);
    const firstDay = resolved.getWeekInfo?.().firstDay ?? resolved.weekInfo?.firstDay;
    return firstDay === undefined ? 0 : firstDay % 7;
  } catch {
    return 0;
  }
}

const WEEK_STARTS_ON = resolveWeekStartsOn();

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** The weeks that cover `month`, padded with outside days (day-picker without fixedWeeks). */
function monthWeeks(month: Date): Date[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() - WEEK_STARTS_ON + 7) % 7;
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const weeks: Date[][] = [];
  do {
    const week: Date[] = [];
    for (let day = 0; day < 7; day += 1) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === month.getMonth());
  return weeks;
}

export function Calendar({
  selected,
  disabledBefore,
  onSelect,
  testId,
}: {
  selected: Date;
  /** Days before this one are disabled. */
  disabledBefore: Date;
  onSelect: (date: Date) => void;
  testId?: string;
}) {
  const theme = useTheme();
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const today = new Date();
  const minimum = startOfDay(disabledBefore);
  const weeks = monthWeeks(month);
  const weekdayLabels = weeks[0]!.map((day) =>
    day.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
  );
  const shiftMonth = (delta: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));

  return (
    <div testId={testId} style={{ display: "flex", flexDirection: "column", width: CELL * 7 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          height: CELL,
          marginBottom: 4,
        }}
      >
        <NavButton icon="chevron-left" testId={testId ? `${testId}-prev` : undefined} onClick={() => shiftMonth(-1)} />
        <Text weight={500}>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</Text>
        <NavButton icon="chevron-right" testId={testId ? `${testId}-next` : undefined} onClick={() => shiftMonth(1)} />
      </div>
      <div style={{ display: "flex", flexDirection: "row" }}>
        {weekdayLabels.map((label, index) => (
          <div
            key={index}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: CELL, height: CELL }}
          >
            <Text size="xs" weight={500} color={alpha(theme.mutedForeground, 0.72)}>
              {label}
            </Text>
          </div>
        ))}
      </div>
      {weeks.map((week, weekIndex) => (
        <div key={weekIndex} style={{ display: "flex", flexDirection: "row" }}>
          {week.map((day) => (
            <DayCell
              key={day.getTime()}
              day={day}
              outside={day.getMonth() !== month.getMonth()}
              disabled={day < minimum}
              selected={sameDay(day, selected)}
              today={sameDay(day, today)}
              testId={testId ? `${testId}-day-${day.getMonth() + 1}-${day.getDate()}` : undefined}
              onSelect={() => onSelect(day)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function NavButton({ icon, onClick, testId }: { icon: "chevron-left" | "chevron-right"; onClick: () => void; testId?: string }) {
  const theme = useTheme();
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: CELL,
        height: CELL,
        borderRadius: RADIUS.lg,
        cursor: "pointer",
        hover: { backgroundColor: theme.accent },
      }}
    >
      <Icon name={icon} size={16} color={theme.foreground} opacity={0.8} />
    </div>
  );
}

function DayCell({
  day,
  outside,
  disabled,
  selected,
  today,
  testId,
  onSelect,
}: {
  day: Date;
  outside: boolean;
  disabled: boolean;
  selected: boolean;
  today: boolean;
  testId?: string;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const color = selected
    ? theme.primaryForeground
    : disabled || outside
      ? alpha(theme.mutedForeground, 0.72)
      : theme.foreground;
  return (
    <div style={{ width: CELL, height: CELL + 2, paddingTop: 1, paddingBottom: 1 }}>
      <div
        testId={testId}
        onClick={disabled ? undefined : onSelect}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: CELL,
          height: CELL,
          borderRadius: RADIUS.lg,
          backgroundColor: selected ? theme.primary : "#00000000",
          cursor: disabled ? "default" : "pointer",
          ...(disabled || selected ? {} : { hover: { backgroundColor: theme.accent } }),
        }}
      >
        <Text color={color} style={disabled ? { textDecoration: "line-through" } : undefined}>
          {String(day.getDate())}
        </Text>
        {today ? (
          <div
            style={{
              position: "absolute",
              bottom: 4,
              left: (CELL - 3) / 2,
              width: 3,
              height: 3,
              borderRadius: 1.5,
              backgroundColor: selected ? theme.background : disabled ? alpha(theme.foreground, 0.3) : theme.primary,
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
