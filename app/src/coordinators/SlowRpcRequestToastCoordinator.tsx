// apps/web/src/components/SlowRpcRequestToastCoordinator.tsx. Requests are
// tracked by web/rpc/requestLatencyState.ts, fed by layerRpcRequestObserver
// (coordinators/rpcRequestObserver.ts) on the connection runtime.
import { useEffect, useRef } from "react";

import { startDevSlowRequests } from "../state/coordinators.ts";
import { Text } from "../ui/primitives.tsx";
import { alpha, useTheme } from "../ui/theme.ts";
import { dismissToast, toast, updateToast, type ToastInput } from "../ui/toast.tsx";
import { type SlowRpcAckRequest, useSlowRpcAckRequests } from "../web/rpc/requestLatencyState.ts";

function describeSlowRequests(requests: ReadonlyArray<SlowRpcAckRequest>): string {
  const count = requests.length;
  const thresholdSeconds = Math.round(
    Math.min(...requests.map((request) => request.thresholdMs)) / 1000,
  );

  return `${count} request${count === 1 ? "" : "s"} waiting longer than ${thresholdSeconds}s.`;
}

function SlowRequestDetails({ requests }: { requests: ReadonlyArray<SlowRpcAckRequest> }) {
  const theme = useTheme();
  return (
    // web: ul.space-y-2.5.text-xs, each li bordered below except the last.
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {requests.map((request, index) => {
        const last = index === requests.length - 1;
        return (
          <div
            key={request.requestId}
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              ...(last ? {} : { paddingBottom: 8, borderBottomWidth: 1, borderColor: alpha(theme.border, 0.5) }),
            }}
          >
            <Text size="xs" weight={500}>
              {request.tag}
            </Text>
            <Text size="3xs" color={alpha(theme.mutedForeground, 0.75)} style={{ marginTop: 2 }}>
              {`Started ${new Date(request.startedAt).toLocaleTimeString()}`}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

export function SlowRpcRequestToastCoordinator() {
  const slowRequests = useSlowRpcAckRequests();
  const toastIdRef = useRef<number | null>(null);

  useEffect(() => startDevSlowRequests(), []);

  useEffect(() => {
    if (slowRequests.length === 0) {
      if (toastIdRef.current !== null) {
        dismissToast(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }

    const nextToast: ToastInput = {
      expandable: {
        content: <SlowRequestDetails requests={slowRequests} />,
        descriptionTrigger: true,
        labels: { collapse: "Hide requests", expand: "Show requests" },
      },
      description: describeSlowRequests(slowRequests),
      duration: 0,
      title: "Some requests are slow",
      type: "warning",
    };

    if (toastIdRef.current === null) {
      toastIdRef.current = toast(nextToast);
    } else {
      updateToast(toastIdRef.current, nextToast);
    }
  }, [slowRequests]);

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
