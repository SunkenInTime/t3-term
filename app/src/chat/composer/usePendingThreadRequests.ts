// Port of apps/web/src/components/chat/usePendingThreadRequests.ts.
// Pending approvals and user-input questions for the active thread: what is waiting,
// the user's in-progress answers, and the commands that respond. Composer.tsx drives
// the approval / question banners and the editor from this.
//
// Differences from web: answers live in module atoms instead of zustand stores, the
// composer prompt is the t3-term draft (`state/composer.ts`), and each question's
// attachments live in a composer draft of their own (questionAttachments.ts).
import { useAtomValue } from "@effect/atom-react";
import {
  derivePendingThreadRequests,
  seedUserInputDraftAnswers,
  type ThreadPendingApproval,
  type ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProviderApprovalDecision,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom, AsyncResult } from "effect/reactivity";
import { useEffect, useMemo, useRef, useState } from "react";

import { appAtomRegistry } from "../../runtime/runtime.ts";
import { composerTargetKey, readComposerDraft, setComposerPrompt } from "../../state/composer.ts";
import { environmentThreads, threadEnvironment } from "../../state/environment.ts";
import { toast } from "../../ui/toast.tsx";
import {
  clearAnsweredQuestionAttachments,
  collectQuestionAttachments,
  environmentSupportsQuestionAttachments,
  pruneQuestionAttachmentDrafts,
  questionAttachmentDraftKey,
  questionAttachmentStatusAtom,
  questionAttachmentStatusKey,
} from "./questionAttachments.ts";
import {
  buildPendingUserInputAnswers,
  carryDisplacedCustomAnswerIntoPrompt,
  derivePendingUserInputProgress,
  pendingUserInputRequestKey,
  pruneResolvedUserInputDrafts,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../web/pendingUserInput.ts";

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

type DraftsByRequestKey = Record<string, Record<string, PendingUserInputDraftAnswer>>;

// Module atoms, like web's zustand stores: drafts survive the composer remounting
// (thread switches) and are pruned once their request resolves.
const pendingUserInputAnswersAtom = Atom.make<DraftsByRequestKey>({}).pipe(Atom.keepAlive);
const pendingUserInputQuestionIndexAtom = Atom.make<Record<string, number>>({}).pipe(Atom.keepAlive);

function updateAnswers(update: (existing: DraftsByRequestKey) => DraftsByRequestKey): void {
  const existing = appAtomRegistry.get(pendingUserInputAnswersAtom);
  const next = update(existing);
  if (next !== existing) appAtomRegistry.set(pendingUserInputAnswersAtom, next);
}

function updateQuestionIndex(update: (existing: Record<string, number>) => Record<string, number>): void {
  const existing = appAtomRegistry.get(pendingUserInputQuestionIndexAtom);
  const next = update(existing);
  if (next !== existing) appAtomRegistry.set(pendingUserInputQuestionIndexAtom, next);
}

const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
const NO_PENDING_APPROVALS: ReadonlyArray<ThreadPendingApproval> = [];
const NO_PENDING_USER_INPUTS: ReadonlyArray<ThreadPendingUserInput> = [];
const NO_RESPONDING: ReadonlyArray<RuntimeRequestId> = [];

// Stands in for the thread state atom while the route has no thread, so the hook
// never opens a subscription for an empty thread id.
const NO_THREAD_STATE_ATOM = Atom.make(AsyncResult.initial()) as unknown as ReturnType<
  typeof environmentThreads.stateAtom
>;

const NO_QUESTION_ATTACHMENT_STATUS = Atom.make<Readonly<Record<string, { count: number; blocked: boolean }>>>({});

function reportFailure(result: AtomCommandResult<unknown, unknown>, fallback: string): void {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toast({ type: "error", title: error instanceof Error ? error.message : fallback });
}

// apps/web/src/session-logic.ts derivePendingApprovals / derivePendingUserInputs: oldest first.
function sortByCreatedAt<T extends { readonly createdAt: string }>(requests: ReadonlyArray<T>): T[] {
  return [...requests].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function addId(ids: ReadonlyArray<RuntimeRequestId>, id: RuntimeRequestId) {
  return ids.includes(id) ? ids : [...ids, id];
}

export function usePendingThreadRequests(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
}): PendingThreadRequestsState {
  const { environmentId, threadId } = input;
  const result = useAtomValue(
    threadId === null ? NO_THREAD_STATE_ATOM : environmentThreads.stateAtom(environmentId, threadId),
  );
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;
  const projectedThreadId = projection?.thread.id ?? null;

  // The projection changes on every streamed event. Re-derive only when the request
  // inputs change, and hand out shared empties so nothing re-renders while idle.
  const runtimeRequests = projection?.runtimeRequests;
  const turnItems = projection?.turnItems;
  const { pendingApprovals, pendingUserInputs } = useMemo(() => {
    if (!runtimeRequests || !turnItems || projectedThreadId !== threadId) {
      return { pendingApprovals: NO_PENDING_APPROVALS, pendingUserInputs: NO_PENDING_USER_INPUTS };
    }
    if (!runtimeRequests.some((request) => request.status === "pending")) {
      return { pendingApprovals: NO_PENDING_APPROVALS, pendingUserInputs: NO_PENDING_USER_INPUTS };
    }
    const requests = derivePendingThreadRequests({ runtimeRequests, turnItems });
    return {
      pendingApprovals:
        requests.approvals.length === 0 ? NO_PENDING_APPROVALS : sortByCreatedAt(requests.approvals),
      pendingUserInputs:
        requests.userInputs.length === 0 ? NO_PENDING_USER_INPUTS : sortByCreatedAt(requests.userInputs),
    };
  }, [runtimeRequests, turnItems, projectedThreadId, threadId]);

  const [respondingRequestIds, setRespondingRequestIds] = useState<ReadonlyArray<RuntimeRequestId>>(NO_RESPONDING);
  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] =
    useState<ReadonlyArray<RuntimeRequestId>>(NO_RESPONDING);
  const userInputResponsesInFlight = useRef(new Set<string>());

  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingRequestKey = pendingUserInputRequestKey(
    environmentId,
    threadId,
    activePendingUserInput?.requestId,
  );
  const allAnswers = useAtomValue(pendingUserInputAnswersAtom);
  const allQuestionIndexes = useAtomValue(pendingUserInputQuestionIndexAtom);
  const activePendingAnswerDrafts = allAnswers[activePendingRequestKey] ?? EMPTY_PENDING_USER_INPUT_ANSWERS;
  const activePendingQuestionIndex = allQuestionIndexes[activePendingRequestKey] ?? 0;

  // Questions with an initial answer start with it in the editor.
  useEffect(() => {
    if (!activePendingUserInput) return;
    updateAnswers((existing) => {
      const drafts = existing[activePendingRequestKey] ?? EMPTY_PENDING_USER_INPUT_ANSWERS;
      const seeded = seedUserInputDraftAnswers(activePendingUserInput.questions, drafts);
      return seeded === drafts ? existing : { ...existing, [activePendingRequestKey]: seeded };
    });
  }, [activePendingRequestKey, activePendingUserInput]);

  // A thread shell can arrive before its requests; missing detail is not resolution.
  useEffect(() => {
    if (threadId === null || projectedThreadId !== threadId) return;
    const pendingRequestIds = pendingUserInputs.map((request) => request.requestId);
    updateAnswers((existing) =>
      pruneResolvedUserInputDrafts(existing, environmentId, threadId, pendingRequestIds),
    );
    updateQuestionIndex((existing) =>
      pruneResolvedUserInputDrafts(existing, environmentId, threadId, pendingRequestIds),
    );
    pruneQuestionAttachmentDrafts(
      environmentId,
      threadId,
      new Set(
        pendingUserInputs.flatMap((request) =>
          request.questions.map((question) => questionAttachmentDraftKey(environmentId, threadId, request.requestId, question.id)),
        ),
      ),
    );
  }, [environmentId, threadId, projectedThreadId, pendingUserInputs]);

  // web: a question's attachments count as an answer, and an upload still going holds it.
  const questionAttachmentStatus = useAtomValue(
    activePendingUserInput && threadId
      ? questionAttachmentStatusAtom(
          questionAttachmentStatusKey(
            environmentId,
            threadId,
            activePendingUserInput.requestId,
            activePendingUserInput.questions.map((question) => question.id),
          ),
        )
      : NO_QUESTION_ATTACHMENT_STATUS,
  );
  const supportsQuestionAttachments = environmentSupportsQuestionAttachments(environmentId);
  const activePendingDraftAnswers = useMemo(() => {
    if (!activePendingUserInput) return EMPTY_PENDING_USER_INPUT_ANSWERS;
    if (Object.values(questionAttachmentStatus).every((status) => status.count === 0)) return activePendingAnswerDrafts;
    return Object.fromEntries(
      activePendingUserInput.questions.map((question) => {
        const status = questionAttachmentStatus[question.id];
        return [
          question.id,
          {
            ...activePendingAnswerDrafts[question.id],
            attachmentCount: status?.count ?? 0,
            attachmentsBlocked: ((status?.count ?? 0) > 0 && !supportsQuestionAttachments) || status?.blocked === true,
          },
        ];
      }),
    );
  }, [activePendingUserInput, activePendingAnswerDrafts, questionAttachmentStatus, supportsQuestionAttachments]);
  const activePendingProgress = activePendingUserInput
    ? derivePendingUserInputProgress(
        activePendingUserInput.questions,
        activePendingDraftAnswers,
        activePendingQuestionIndex,
      )
    : null;
  const activePendingResolvedAnswers = activePendingUserInput
    ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
    : null;
  const activePendingIsResponding = activePendingUserInput
    ? activePendingUserInput.responseCapability === "not_resumable" ||
      respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;
  const activePendingApproval = pendingApprovals[0] ?? null;

  // Handlers read the latest render through this ref so their identity stays stable.
  const latest = {
    environmentId,
    threadId,
    pendingApprovals,
    pendingUserInputs,
    activePendingUserInput,
    activePendingRequestKey,
    activePendingAnswerDrafts,
    activePendingProgress,
    activePendingResolvedAnswers,
  };
  const latestRef = useRef(latest);
  latestRef.current = latest;

  const handlers = useMemo(() => {
    const onRespondToApproval = async (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => {
      const { environmentId, threadId, pendingApprovals } = latestRef.current;
      if (!threadId) return;
      if (pendingApprovals.find((approval) => approval.requestId === requestId)?.responseCapability !== "live") {
        return;
      }
      setRespondingRequestIds((existing) => addId(existing, requestId));
      const result = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.respondToApproval,
        { environmentId, input: { threadId, requestId, decision } },
        { reportFailure: false },
      );
      reportFailure(result, "Failed to submit approval decision.");
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
      return result;
    };

    const onRespondToUserInput = async (requestId: RuntimeRequestId, answers: Record<string, unknown>) => {
      const { environmentId, threadId, pendingUserInputs } = latestRef.current;
      if (!threadId) return;
      const pendingInput = pendingUserInputs.find((entry) => entry.requestId === requestId);
      if (!pendingInput || pendingInput.responseCapability === "not_resumable") return;
      const responseKey = JSON.stringify([environmentId, threadId, requestId]);
      if (userInputResponsesInFlight.current.has(responseKey)) return;
      const questionIds = pendingInput.questions.map((question) => question.id);
      const collected = collectQuestionAttachments(environmentId, threadId, requestId, questionIds);
      if ("error" in collected) {
        toast({ type: "error", title: collected.error });
        return;
      }
      userInputResponsesInFlight.current.add(responseKey);
      setRespondingUserInputRequestIds((existing) => addId(existing, requestId));
      const result = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.respondToUserInput,
        {
          environmentId,
          input: {
            threadId,
            requestId,
            answers,
            ...(Object.keys(collected.attachments).length > 0 ? { attachmentsByQuestionId: collected.attachments as never } : {}),
          },
        },
        { reportFailure: false },
      );
      reportFailure(result, "Failed to submit user input.");
      if (result._tag === "Success") clearAnsweredQuestionAttachments(environmentId, threadId, requestId, questionIds);
      userInputResponsesInFlight.current.delete(responseKey);
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
      return result;
    };

    // Closes an async question without messaging the agent. The server records the
    // dismissal so every client releases the composer.
    const onDismissUserInput = (requestId: RuntimeRequestId) => {
      const { environmentId, threadId } = latestRef.current;
      if (!threadId) return;
      setRespondingUserInputRequestIds((existing) => addId(existing, requestId));
      void runAtomCommand(
        appAtomRegistry,
        threadEnvironment.dismissUserInput,
        { environmentId, input: { threadId, requestId } },
        { reportFailure: false },
      ).then((result) => {
        reportFailure(result, "Failed to dismiss the question.");
        setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
      });
    };

    const setActivePendingUserInputQuestionIndex = (nextQuestionIndex: number) => {
      const { activePendingUserInput, activePendingRequestKey } = latestRef.current;
      if (!activePendingUserInput) return;
      updateQuestionIndex((existing) => ({ ...existing, [activePendingRequestKey]: nextQuestionIndex }));
    };

    const onSelectActivePendingUserInputOption = (questionId: string, optionValue: string) => {
      const { environmentId, threadId, activePendingUserInput, activePendingRequestKey, activePendingAnswerDrafts } =
        latestRef.current;
      if (!activePendingUserInput) return;
      // The option replaces the custom answer. Anything typed there is the user's
      // text, so it goes back to the thread draft instead of vanishing.
      if (threadId) {
        const draftKey = composerTargetKey({ kind: "thread", environmentId, threadId });
        const currentPrompt = readComposerDraft(draftKey).prompt;
        const nextPrompt = carryDisplacedCustomAnswerIntoPrompt(
          currentPrompt,
          activePendingAnswerDrafts[questionId]?.customAnswer,
        );
        if (nextPrompt !== currentPrompt) setComposerPrompt(draftKey, nextPrompt);
      }
      const question = activePendingUserInput.questions.find((entry) => entry.id === questionId);
      if (!question) return;
      updateAnswers((existing) => ({
        ...existing,
        [activePendingRequestKey]: {
          ...existing[activePendingRequestKey],
          [questionId]: togglePendingUserInputOptionSelection(
            question,
            existing[activePendingRequestKey]?.[questionId],
            optionValue,
          ),
        },
      }));
    };

    const onChangeActivePendingUserInputCustomAnswer = (questionId: string, value: string) => {
      const { activePendingUserInput, activePendingRequestKey } = latestRef.current;
      if (!activePendingUserInput) return;
      const question = activePendingUserInput.questions.find((entry) => entry.id === questionId);
      if (!question || question.allowCustomAnswer === false) return;
      updateAnswers((existing) => ({
        ...existing,
        [activePendingRequestKey]: {
          ...existing[activePendingRequestKey],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingRequestKey]?.[questionId],
            value,
            question,
          ),
        },
      }));
    };

    // Reads the drafts straight from the atom: an option click schedules this right
    // after writing its answer, before React re-renders with it.
    const onAdvanceActivePendingUserInput = () => {
      const { activePendingUserInput, activePendingRequestKey } = latestRef.current;
      if (!activePendingUserInput || activePendingUserInput.responseCapability === "not_resumable") return;
      const drafts =
        appAtomRegistry.get(pendingUserInputAnswersAtom)[activePendingRequestKey] ??
        EMPTY_PENDING_USER_INPUT_ANSWERS;
      const questionIndex = appAtomRegistry.get(pendingUserInputQuestionIndexAtom)[activePendingRequestKey] ?? 0;
      const progress = derivePendingUserInputProgress(activePendingUserInput.questions, drafts, questionIndex);
      if (progress.isLastQuestion) {
        const answers = buildPendingUserInputAnswers(activePendingUserInput.questions, drafts);
        if (answers) void onRespondToUserInput(activePendingUserInput.requestId, answers);
        return;
      }
      setActivePendingUserInputQuestionIndex(progress.questionIndex + 1);
    };

    const onPreviousActivePendingUserInputQuestion = () => {
      const { activePendingProgress } = latestRef.current;
      if (!activePendingProgress) return;
      setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
    };

    return {
      onRespondToApproval,
      onDismissUserInput,
      onSelectActivePendingUserInputOption,
      onChangeActivePendingUserInputCustomAnswer,
      onAdvanceActivePendingUserInput,
      onPreviousActivePendingUserInputQuestion,
    };
  }, []);

  return {
    pendingApprovals,
    pendingUserInputs,
    activePendingApproval,
    activePendingUserInput,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    respondingRequestIds,
    ...handlers,
  };
}
