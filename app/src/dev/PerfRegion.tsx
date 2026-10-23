// Wraps a region in React's <Profiler> while the perf probe runs (T3TERM_PERF),
// so a phase summary says which regions re-rendered and for how long.
import { Profiler, type ReactNode } from "react";

import { perfOnRender, perfProbeEnabled } from "./perfProbe.ts";

export function PerfRegion({ id, children }: { id: string; children: ReactNode }) {
  if (!perfProbeEnabled) return <>{children}</>;
  return (
    <Profiler id={id} onRender={perfOnRender}>
      {children}
    </Profiler>
  );
}
