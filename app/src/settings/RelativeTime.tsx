// apps/web/src/components/RelativeTime.tsx + hooks/useRelativeTimeState.ts:
// a "5m ago" label that re-renders only when its text changes.
import { useEffect, useState } from "react";

import { formatRelativeTimeLabel, msUntilRelativeTimeChange } from "../web/timestampFormat.ts";

export function useRelativeTimeLabel(isoDate: string | null): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (isoDate === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delayMs = msUntilRelativeTimeChange(isoDate);
      if (delayMs === null) return;
      timer = setTimeout(() => {
        setTick((tick) => tick + 1);
        schedule();
      }, delayMs);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [isoDate]);
  return isoDate === null ? "" : formatRelativeTimeLabel(isoDate);
}
