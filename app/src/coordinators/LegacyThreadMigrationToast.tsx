// apps/web/src/components/LegacyThreadMigrationToast.tsx
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import { primaryServerLegacyThreadMigrationAtom } from "../state/coordinators.ts";
import { dismissToast, toast } from "../ui/toast.tsx";

export function LegacyThreadMigrationToast() {
  const migration = useAtomValue(primaryServerLegacyThreadMigrationAtom);
  const toastIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (migration?.status === "running") {
      if (toastIdRef.current !== null) {
        return;
      }
      toastIdRef.current = toast({
        type: "loading",
        title: "Restoring your threads…",
        description: `Migrating ${migration.totalThreadCount.toLocaleString()} ${
          migration.totalThreadCount === 1 ? "thread" : "threads"
        } from the previous version. You can keep working while this finishes.`,
        duration: 0,
      });
      return;
    }

    if (toastIdRef.current !== null) {
      dismissToast(toastIdRef.current);
      toastIdRef.current = null;
    }
  }, [migration]);

  useEffect(
    () => () => {
      if (toastIdRef.current !== null) {
        dismissToast(toastIdRef.current);
      }
    },
    [],
  );

  return null;
}
