// Paints pending measurement probes (measure.ts) out of sight and feeds their
// laid-out widths back. Mounted once by the timeline; probes only exist until
// their first layout, so a settled app paints none.
import { useEffect, useReducer } from "react";

import { MEASURE_FONT_SIZE, pendingProbes, recordProbe, setMeasureHostUpdater } from "./measure.ts";

export function TextMeasureHost() {
  const [, bump] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    setMeasureHostUpdater(bump);
    return () => setMeasureHostUpdater(null);
  }, []);
  const probes = pendingProbes();
  if (probes.length === 0) return null;
  return (
    // Zero-size and clipped: probes lay out (and report widths) without showing.
    <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: 100000 }}>
        {probes.map((probe) => (
          <text
            key={probe.id}
            onLayout={(event) => recordProbe(probe, event.width ?? 0)}
            style={{
              fontFamily: probe.family,
              fontWeight: probe.face.weight,
              fontSize: MEASURE_FONT_SIZE,
              lineHeight: 28,
              whiteSpace: "nowrap",
              color: "#00000000",
              userSelect: "none",
            }}
          >
            {probe.text}
          </text>
        ))}
      </div>
    </div>
  );
}
