// Port of apps/web/src/components/chat/ComposerBannerStack.tsx. The most urgent
// notice docks above the composer; the rest wait behind a 12px peek and fan out
// above it while the pointer is over the stack.
//
// Not ported: the 150/220ms enter/exit transitions (GPUI has no CSS transitions) and
// the "Show details" popover for truncated text.
import { useState, type ReactNode } from "react";

import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  BannerActions,
  BannerAttachment,
  BannerContent,
  BannerIcon,
  BannerIconButton,
  BannerRoot,
  BannerRow,
  BannerText,
  type ComposerBannerVariant,
} from "./ComposerBannerParts.tsx";

export interface ComposerBannerStackItem {
  readonly id: string;
  readonly variant: ComposerBannerVariant;
  readonly priority?: "urgent" | "activity" | "notice";
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

export type ComposerBannerStackContent = Pick<ComposerBannerStackItem, "id" | "variant" | "priority"> & {
  readonly content: ReactNode;
};

export type ComposerBannerStackEntry = ComposerBannerStackItem | ComposerBannerStackContent;

function bannerPriority(item: ComposerBannerStackEntry) {
  if (item.priority === "urgent" || item.variant === "error" || item.variant === "warning") return 0;
  if (item.priority === "activity") return 1;
  return 2;
}

export function ComposerBannerStack({
  items,
  attachedAbove,
  frontJoinedAbove = false,
}: {
  readonly items: ReadonlyArray<ComposerBannerStackEntry>;
  readonly attachedAbove?: ReactNode;
  /** An attached surface from `attachedAbove` rendered right above the front notice. */
  readonly frontJoinedAbove?: boolean;
}) {
  const theme = useTheme();
  const [stackExpanded, setStackExpanded] = useState(false);

  // A stack that shrinks to one banner collapses, so the next stack starts collapsed.
  if (items.length < 2 && stackExpanded) setStackExpanded(false);

  const orderedItems = items.toSorted((a, b) => bannerPriority(a) - bannerPriority(b));
  const frontItem = orderedItems[0];
  if (!frontItem) return <>{attachedAbove}</>;
  const stackedItems = orderedItems.slice(1);
  const firstStackedItem = stackedItems[0];

  return (
    <>
      {firstStackedItem ? (
        <div
          testId="banner-stack"
          onMouseEnter={() => setStackExpanded(true)}
          onMouseLeave={() => setStackExpanded(false)}
          style={{ display: "flex", flexDirection: "column", minHeight: 12, pointerEvents: "auto" }}
        >
          {stackExpanded ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8 }}>
              {stackedItems.map((item) => (
                <ComposerBannerStackAlert key={item.id} item={item} attached={false} />
              ))}
            </div>
          ) : (
            // ComposerBanner.Peek: a 96%-wide cap of the next notice behind the front one.
            <div style={{ display: "flex", flexDirection: "row", justifyContent: "center" }}>
              <div
                testId="banner-stack-peek"
                onClick={() => setStackExpanded(true)}
                style={{
                  width: "96%",
                  height: 12,
                  borderTopLeftRadius: RADIUS["2xl"],
                  borderTopRightRadius: RADIUS["2xl"],
                  borderTopWidth: 1,
                  borderLeftWidth: 1,
                  borderRightWidth: 1,
                  borderColor:
                    firstStackedItem.variant === "error"
                      ? alpha(theme.error, 0.24)
                      : firstStackedItem.variant === "warning"
                        ? alpha(theme.warning, 0.24)
                        : theme.appearance === "dark"
                          ? alpha("#ffffff", 0.05)
                          : alpha(theme.foreground, 0.08),
                  backgroundColor: alpha(theme.card, 0.94),
                  cursor: "pointer",
                }}
              />
            </div>
          )}
        </div>
      ) : null}
      {attachedAbove}
      <BannerAttachment testId="banner-stack-front">
        <ComposerBannerStackAlert key={frontItem.id} item={frontItem} attached joinedAbove={frontJoinedAbove} />
      </BannerAttachment>
    </>
  );
}

function ComposerBannerStackAlert({
  item,
  attached,
  joinedAbove = false,
}: {
  item: ComposerBannerStackEntry;
  attached: boolean;
  joinedAbove?: boolean;
}) {
  const theme = useTheme();
  const placement = attached ? "attached" : "floating";
  if ("content" in item) {
    return (
      <BannerRoot density="comfortable" placement={placement} variant={item.variant} joinedAbove={joinedAbove}>
        {item.content}
      </BannerRoot>
    );
  }
  return (
    <BannerRoot
      density="comfortable"
      placement={placement}
      variant={item.variant}
      joinedAbove={joinedAbove}
      testId={`banner-${item.id}`}
    >
      <BannerRow>
        <BannerIcon style={{ alignSelf: "flex-start" }}>{item.icon}</BannerIcon>
        <BannerContent>
          {typeof item.title === "string" ? (
            <BannerText weight={500} truncate style={{ lineHeight: 24 }}>
              {item.title}
            </BannerText>
          ) : (
            item.title
          )}
          {item.description ? (
            typeof item.description === "string" ? (
              <BannerText truncate grow color={theme.mutedForeground}>
                {item.description}
              </BannerText>
            ) : (
              item.description
            )
          ) : null}
        </BannerContent>
        {item.actions || item.onDismiss ? (
          <BannerActions>
            {item.actions}
            {item.onDismiss ? (
              <BannerIconButton icon="x" testId={`banner-${item.id}-dismiss`} onClick={item.onDismiss} />
            ) : null}
          </BannerActions>
        ) : null}
      </BannerRow>
      {item.children ? <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{item.children}</div> : null}
    </BannerRoot>
  );
}
