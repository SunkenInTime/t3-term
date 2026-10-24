// Dev-only attachment states, for screenshots of the upload strip without an OS file picker
// or drag and drop (neither can be driven by gpuix automation). Inert unless set:
//
//   T3TERM_DEV_ATTACH_PATHS=C:\a.png|C:\b.pdf  stages these files in the first composer that
//                                              mounts, the way a file drop does
//   T3TERM_DEV_UPLOAD_DELAY_MS=40              waits this long before an upload's first byte
//                                              and between its 256 KB chunks
//   T3TERM_DEV_UPLOAD_FAIL=1                   fails every upload before its bytes go out
//   T3TERM_DEV_SEND_HOLD=1                     holds every send just before its startTurn, for
//                                              good: the pending state stays and no run starts
export const DEV_ATTACH_PATHS: ReadonlyArray<string> = (process.env.T3TERM_DEV_ATTACH_PATHS ?? "")
  .split("|")
  .map((path) => path.trim())
  .filter(Boolean);

export const DEV_UPLOAD_DELAY_MS = Number(process.env.T3TERM_DEV_UPLOAD_DELAY_MS ?? 0) || 0;
export const DEV_UPLOAD_FAIL = process.env.T3TERM_DEV_UPLOAD_FAIL === "1";
export const DEV_SEND_HOLD = process.env.T3TERM_DEV_SEND_HOLD === "1";

const DEV_ATTACH_PROJECT = process.env.T3TERM_DEV_ATTACH_PROJECT ?? "t3term-sandbox";
const DEV_ATTACH_TARGET = process.env.T3TERM_DEV_ATTACH_TARGET ?? "";
let devAttachConsumed = false;

/** The dev paths once per process: later composers start empty. */
export function takeDevAttachPaths(projectTitle: string | null, targetKind: "thread" | "draft" | "question"): ReadonlyArray<string> {
  if (devAttachConsumed || DEV_ATTACH_PATHS.length === 0 || projectTitle !== DEV_ATTACH_PROJECT) return [];
  if (DEV_ATTACH_TARGET !== "" && DEV_ATTACH_TARGET !== targetKind) return [];
  devAttachConsumed = true;
  return DEV_ATTACH_PATHS;
}
