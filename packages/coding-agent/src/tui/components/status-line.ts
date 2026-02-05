import { bold, dim, fg, stringToStyledText, t, type StyledText } from "@opentui/core";
import { colors } from "../theme";

export type StatusLineState = {
  header: string;
  elapsed?: string;
  showInterruptHint: boolean;
};

export function buildStatusText(state: StatusLineState): StyledText {
  const header = state.header;
  if (!header || header === "Ready") {
    return stringToStyledText("");
  }

  const bullet = dim("•");
  const headerChunk = header.startsWith("Error:") ? fg(colors.error)(header) : bold(header);
  const elapsed = state.elapsed;
  if (elapsed && state.showInterruptHint) {
    return t`${bullet} ${headerChunk} ${dim("(")}${dim(elapsed)}${dim(" • ")}${fg(colors.accent)(
      "esc"
    )}${dim(" to interrupt)")}`;
  }
  if (elapsed) {
    return t`${bullet} ${headerChunk} ${dim("(")}${dim(elapsed)}${dim(")")}`;
  }
  return t`${bullet} ${headerChunk}`;
}
