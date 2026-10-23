// Type-only port of apps/web/src/state/environments.ts. The hooks live in
// app/src/state/settings.ts; pure logic imports only this shape.
import type { EnvironmentPresentation as BaseEnvironmentPresentation } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";

export interface EnvironmentPresentation extends BaseEnvironmentPresentation {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly displayUrl: string | null;
  readonly relayManaged: boolean;
}
