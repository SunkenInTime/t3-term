// Chooses between the connect screen and the app, the way web's root route
// renders only the /pair surface until a session exists (routes/__root.tsx).
import { useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";

import { connectGateAtom } from "../state/connect.ts";
import { environmentCatalog } from "../state/environment.ts";
import { useTheme } from "../ui/theme.ts";
import { ConnectScreen } from "./ConnectScreen.tsx";

export function ConnectGate({
  bootError,
  children,
}: {
  readonly bootError: string | null;
  readonly children: ReactNode;
}) {
  const theme = useTheme();
  // Mounting the catalog starts the connection registry; saved environments reconnect.
  useAtomValue(environmentCatalog.catalogAtom);
  const gate = useAtomValue(connectGateAtom);
  if (gate === "pending") {
    return <div style={{ width: "100%", height: "100%", backgroundColor: theme.background }} />;
  }
  if (gate === "connect") return <ConnectScreen initialError={bootError} />;
  return <>{children}</>;
}
