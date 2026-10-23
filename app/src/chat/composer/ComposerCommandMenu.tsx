// OWNER: composer agent (command menu sub-task). STUB: replace with the view port of
// apps/web/src/components/chat/ComposerCommandMenu.tsx. Composer.tsx renders it in an
// anchored layer above the composer body while a trigger (/, @, $) is active and owns the
// keyboard path (highlight moves and selection come in through props).
import type { ComposerTriggerKind } from "../../web/composer-logic.ts";
import type { ComposerCommandItem } from "../../web/components/chat/ComposerCommandMenu.ts";

export interface ComposerCommandMenuProps {
  readonly items: ReadonlyArray<ComposerCommandItem>;
  readonly isLoading: boolean;
  readonly triggerKind: ComposerTriggerKind | null;
  readonly emptyStateText: string;
  readonly activeItemId: string | null;
  readonly onHighlightedItemChange: (itemId: string | null) => void;
  readonly onSelect: (item: ComposerCommandItem) => void;
}

export function ComposerCommandMenu(_props: ComposerCommandMenuProps) {
  return null;
}
