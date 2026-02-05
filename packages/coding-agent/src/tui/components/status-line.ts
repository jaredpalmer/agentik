import { dim, fg, stringToStyledText, t, type StyledText } from "@opentui/core";
import { colors } from "../theme";

export function buildStatusText(text: string): StyledText {
  if (!text || text === "Ready") {
    return stringToStyledText("");
  }

  if (text.startsWith("Tool: ")) {
    const toolName = text.slice("Tool: ".length).trim();
    return t`${dim("Tool: ")}${fg(colors.codex)(toolName)}`;
  }

  if (text.startsWith("Error:")) {
    return t`${fg(colors.error)(text)}`;
  }

  return t`${dim(text)}`;
}
