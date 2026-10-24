// Undo for the composer editor, grouped the way web's composer groups ProseMirror history
// (apps/web/src/composer-undo-grouping.ts, newGroupDelay COMPOSER_UNDO_GROUP_DELAY): runs of
// typing join, runs of deleting join, a switch between them or any other change (paste,
// cut, a chip, Enter) starts a new step, and so does a pause or an edit somewhere else.
import { type Doc, type Pos, type Selection, samePos } from "./doc.ts";

export const COMPOSER_UNDO_GROUP_DELAY = 1000;
const UNDO_LIMIT = 200;

export type ChangeKind = "insert" | "delete" | "other";

interface Snapshot {
  readonly doc: Doc;
  readonly selection: Selection;
}

export class EditorHistory {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private lastKind: ChangeKind | null = null;
  private lastTime = 0;
  private lastCaret: Pos | null = null;

  /** Call before applying a change, with the state it changes. */
  record(before: Snapshot, kind: ChangeKind, caretAfter: Pos, now = Date.now()): void {
    const joins =
      this.lastKind !== null &&
      kind !== "other" &&
      kind === this.lastKind &&
      now - this.lastTime < COMPOSER_UNDO_GROUP_DELAY &&
      this.lastCaret !== null &&
      samePos(this.lastCaret, before.selection.head);
    if (!joins) {
      this.undoStack.push(before);
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastKind = kind;
    this.lastTime = now;
    this.lastCaret = caretAfter;
  }

  /** A caret move ends the current group, like ProseMirror's adjacency rule. */
  breakGroup(): void {
    this.lastKind = null;
  }

  undo(current: Snapshot): Snapshot | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(current);
    this.lastKind = null;
    return previous;
  }

  redo(current: Snapshot): Snapshot | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current);
    this.lastKind = null;
    return next;
  }
}
