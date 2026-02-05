import { dim, fg, t, StyledText } from "@opentui/core";
import { colors } from "../theme";

export type FooterLineState = {
  queuedCount: number;
  width: number;
};

export function buildFooterText(state: FooterLineState): StyledText {
  const left = state.queuedCount > 0 ? `Queued ${state.queuedCount}` : "for shortcuts";
  const leftText =
    state.queuedCount > 0
      ? t`${fg(colors.accent)("●")} ${dim(left)}`
      : t`${fg(colors.accent)("?")} ${dim(left)}`;
  const right = "100% context left";

  if (state.width <= 0) {
    return t``;
  }

  const leftPlain = state.queuedCount > 0 ? `● ${left}` : `? ${left}`;
  if (leftPlain.length >= state.width) {
    const truncated = leftPlain.slice(0, Math.max(0, state.width - 1));
    return t`${dim(truncated)}…`;
  }

  if (right.length + leftPlain.length + 1 > state.width) {
    return leftText;
  }

  const gap = state.width - leftPlain.length - right.length;
  return new StyledText([
    ...leftText.chunks,
    ...t`${dim(" ".repeat(Math.max(1, gap)))}${dim(right)}`.chunks,
  ]);
}
