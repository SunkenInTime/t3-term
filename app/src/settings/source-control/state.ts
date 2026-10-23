// apps/web/src/state/sourceControl.ts
import { createSourceControlEnvironmentAtoms } from "@t3tools/client-runtime/state/source-control";

import { connectionAtomRuntime } from "../../runtime/runtime.ts";

export const sourceControlEnvironment = createSourceControlEnvironmentAtoms(connectionAtomRuntime);
