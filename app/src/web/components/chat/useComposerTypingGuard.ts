// Ported from apps/web/src/components/chat/useComposerTypingGuard.ts
import { useEffect, useRef, useState } from "react";
import {
  COMPOSER_TYPING_IDLE_MS,
  createComposerTypingGuardState,
  updateComposerTypingGuard,
} from "./composerTypingGuard.ts";

export function useComposerTypingGuard(scope: string, requestIds: readonly string[]) {
  const requestsKey = JSON.stringify(requestIds);
  // t3-term: a keystroke with nothing held only moves lastTypedAt, which matters to the next
  // "requests" event, so it lands in this ref instead of re-rendering the composer on every
  // key (see chat/composer/useTypingDeferredDraft.ts). Events fold it in before they apply.
  const lastTypedAt = useRef(-Infinity);
  const withTyping = (state: ReturnType<typeof createComposerTypingGuardState>) =>
    lastTypedAt.current > state.lastTypedAt ? { ...state, lastTypedAt: lastTypedAt.current } : state;
  const [snapshot, setSnapshot] = useState(() => ({
    scope,
    requestsKey,
    state: updateComposerTypingGuard(createComposerTypingGuardState(), {
      type: "requests",
      requestIds,
      now: Date.now(),
    }),
  }));
  const state = snapshot.state;
  if (snapshot.scope !== scope || snapshot.requestsKey !== requestsKey) {
    if (snapshot.scope !== scope) lastTypedAt.current = -Infinity;
    setSnapshot((current) => ({
      scope,
      requestsKey,
      state: updateComposerTypingGuard(
        current.scope === scope
          ? withTyping(current.state)
          : { ...createComposerTypingGuardState(), focused: current.state.focused },
        { type: "requests", requestIds, now: Date.now() },
      ),
    }));
  }
  const dispatch = (event: Parameters<typeof updateComposerTypingGuard>[1]) => {
    if (event.type === "blur" || event.type === "send" || event.type === "idle") lastTypedAt.current = -Infinity;
    setSnapshot((current) => ({
      ...current,
      state: updateComposerTypingGuard(withTyping(current.state), event),
    }));
  };
  const onDraftChange = () => {
    lastTypedAt.current = Date.now();
    // With requests held, the idle timer below restarts from the new keystroke, as on web.
    if (state.held.size > 0) dispatch({ type: "type", now: lastTypedAt.current });
  };
  const onFocus = () => dispatch({ type: "focus" });
  const onBlur = () => dispatch({ type: "blur" });
  const onSend = () => dispatch({ type: "send" });
  useEffect(() => {
    if (state.held.size === 0) return;
    const timeout = setTimeout(
      () => dispatch({ type: "idle" }),
      Math.max(0, state.lastTypedAt + COMPOSER_TYPING_IDLE_MS - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [state.held, state.lastTypedAt, dispatch]);
  return { heldRequestIds: state.held, onDraftChange, onFocus, onBlur, onSend };
}
