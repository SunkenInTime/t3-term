// A tree row's name the way @pierre/trees lays it out: <MiddleTruncate split="extension"
// minimumLength={5}>. The stem gives way first with an end ellipsis (T3's tree CSS swaps
// pierre's fading marker for text-overflow: ellipsis) and the extension stays readable,
// so "a-very-long-component-name.tsx" becomes "a-very-long-compo….tsx".
import { FONTS } from "../../ui/theme.ts";

const isWhitespace = (char: string | undefined) => char !== undefined && /\s/.test(char);

/** pierre's avoidWhitespaceBoundary(centerSplitIndex). */
function centerSplitIndex(contents: string): number {
  const centerIndex = Math.ceil(contents.length / 2);
  const isOnBoundary = (index: number) => isWhitespace(contents[index - 1]) || isWhitespace(contents[index]);
  if (!isOnBoundary(centerIndex)) return centerIndex;
  for (let offset = 1; offset < contents.length; offset++) {
    const before = centerIndex - offset;
    if (before > 0 && !isOnBoundary(before)) return before;
    const after = centerIndex + offset;
    if (after < contents.length && !isOnBoundary(after)) return after;
  }
  return centerIndex;
}

/** pierre's splitExtension. */
export function splitTreeNameForTruncation(contents: string): readonly [string, string] {
  if (contents.length < 4) return [contents, ""];
  const extensionIndex = contents.lastIndexOf(".") + 1;
  const isTooLong = contents.length - extensionIndex > 10;
  const splitIndex = extensionIndex >= 1 && !isTooLong ? extensionIndex : centerSplitIndex(contents);
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
}

const MINIMUM_LENGTH = 5;

export function TreeName(props: { readonly name: string; readonly color: string; readonly testId?: string }) {
  const textStyle = {
    color: props.color,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.sans,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  } as const;
  if (props.name.length < MINIMUM_LENGTH) {
    return (
      <text style={{ ...textStyle, textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 1 }}>{props.name}</text>
    );
  }
  const [stem, tail] = splitTreeNameForTruncation(props.name);
  // Two boxes, not two sibling <text>s: adjacent texts merge into one line and would
  // truncate as one.
  return (
    <div
      {...(props.testId ? { testId: props.testId } : {})}
      style={{ display: "flex", flexDirection: "row", alignItems: "center", minWidth: 0, flexShrink: 1, pointerEvents: "none" }}
    >
      <div style={{ display: "flex", minWidth: 0, flexShrink: 1, overflow: "hidden" }}>
        <text style={{ ...textStyle, textOverflow: "ellipsis", overflow: "hidden", minWidth: 0, flexShrink: 1 }}>{stem}</text>
      </div>
      {tail ? (
        <div style={{ display: "flex", flexShrink: 0 }}>
          <text style={textStyle}>{tail}</text>
        </div>
      ) : null}
    </div>
  );
}
