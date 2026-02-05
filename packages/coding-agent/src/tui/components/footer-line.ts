import { dim, t, type StyledText } from "@opentui/core";

export type FooterLineState = {
  queuedCount: number;
  width: number;
};

function truncateLine(text: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  if (text.length <= width) {
    return text;
  }
  if (width <= 1) {
    return "…";
  }
  return `${text.slice(0, width - 1)}…`;
}

export function buildFooterText(state: FooterLineState): StyledText {
  let text = "Enter send · Shift+Enter newline · Esc interrupt";
  if (state.queuedCount > 0) {
    text += ` · Queued ${state.queuedCount} (↑ edit)`;
  }
  const truncated = truncateLine(text, state.width);
  return t`${dim(truncated)}`;
}
