// OWNER: composer agent (banners sub-task). STUB: replace with the port of
// apps/web/src/components/chat/usePendingThreadRequests.ts. Keep the return contract;
// Composer.tsx consumes it to drive the approval / user-input banners and the editor.
import { useAtomValue } from "@effect/atom-react";
import {
  derivePendingThreadRequests,
  type ThreadPendingApproval,
  type ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import type {
  EnvironmentId,
  ProviderApprovalDecision,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { environmentThreads } from "../../state/environment.ts";
import type { PendingUserInputDraftAnswer } from "../../web/pendingUserInput.ts";

export interface PendingUserInputProgress {
  readonly questionIndex: number;
  readonly isLastQuestion: boolean;
  readonly canAdvance: boolean;
  readonly customAnswer: string;
  readonly activeQuestion: {
    readonly id: string;
    readonly initialAnswer?: string | undefined;
    readonly multiSelect?: boolean | undefined;
    readonly allowCustomAnswer?: boolean | undefined;
  } | null;
}

export interface PendingThreadRequestsState {
  readonly pendingApprovals: ReadonlyArray<ThreadPendingApproval>;
  readonly pendingUserInputs: ReadonlyArray<ThreadPendingUserInput>;
  readonly activePendingApproval: ThreadPendingApproval | null;
  readonly activePendingUserInput: ThreadPendingUserInput | null;
  readonly activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  readonly activePendingQuestionIndex: number;
  readonly activePendingProgress: PendingUserInputProgress | null;
  readonly activePendingResolvedAnswers: Record<string, unknown> | null;
  readonly activePendingIsResponding: boolean;
  readonly respondingRequestIds: ReadonlyArray<RuntimeRequestId>;
  readonly onRespondToApproval: (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => Promise<unknown>;
  readonly onDismissUserInput: (requestId: RuntimeRequestId) => void;
  readonly onSelectActivePendingUserInputOption: (questionId: string, optionValue: string) => void;
  /** The composer editor holds the custom answer while a question is active. */
  readonly onChangeActivePendingUserInputCustomAnswer: (questionId: string, value: string) => void;
  readonly onAdvanceActivePendingUserInput: () => void;
  readonly onPreviousActivePendingUserInputQuestion: () => void;
}

const noop = () => {};

export function usePendingThreadRequests(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
}): PendingThreadRequestsState {
  const result = useAtomValue(
    environmentThreads.stateAtom(input.environmentId, (input.threadId ?? "") as ThreadId),
  );
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;
  const requests = projection ? derivePendingThreadRequests(projection) : { approvals: [], userInputs: [] };
  return {
    pendingApprovals: requests.approvals,
    pendingUserInputs: requests.userInputs,
    activePendingApproval: requests.approvals[0] ?? null,
    activePendingUserInput: requests.userInputs[0] ?? null,
    activePendingDraftAnswers: {},
    activePendingQuestionIndex: 0,
    activePendingProgress: null,
    activePendingResolvedAnswers: null,
    activePendingIsResponding: false,
    respondingRequestIds: [],
    onRespondToApproval: async () => undefined,
    onDismissUserInput: noop,
    onSelectActivePendingUserInputOption: noop,
    onChangeActivePendingUserInputCustomAnswer: noop,
    onAdvanceActivePendingUserInput: noop,
    onPreviousActivePendingUserInputQuestion: noop,
  };
}
