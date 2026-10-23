// useNowMinute / useNowSecond (apps/web/src/hooks): shared ticks, so every row
// that shows a relative time or a working duration updates in the same frame.
// Only mounted labels subscribe; nothing ticks while no thread is working.
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

function tickAtom(intervalMs: number) {
  return Atom.make((get) => {
    const align = () => intervalMs - (Date.now() % intervalMs);
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        get.setSelf(Date.now());
        schedule();
      }, align());
    };
    schedule();
    get.addFinalizer(() => clearTimeout(timer));
    return Date.now();
  });
}

const nowMinuteAtom = tickAtom(60_000);
/** Exported so other modules can share the tick (the timeline's elapsed labels). */
export const nowSecondAtom = tickAtom(1_000);

export function useNowMinute(): number {
  return useAtomValue(nowMinuteAtom);
}

export function useNowSecond(): number {
  return useAtomValue(nowSecondAtom);
}
