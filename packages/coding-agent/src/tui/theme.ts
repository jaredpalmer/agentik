import type { ThinkingLevel } from "@agentik/agent";
import { RGBA, SyntaxStyle } from "@opentui/core";

export const colors = {
  // Base
  bg: "#1a1b26",
  fg: "#c0caf5",
  dimFg: "#565f89",
  border: "#3b4261",
  focusBorder: "#7aa2f7",

  // Accents
  blue: "#7aa2f7",
  cyan: "#7dcfff",
  green: "#9ece6a",
  yellow: "#e0af68",
  red: "#f7768e",
  magenta: "#bb9af7",
  orange: "#ff9e64",

  // Semantic
  userLabel: "#7aa2f7",
  assistantLabel: "#9ece6a",
  toolLabel: "#e0af68",
  errorFg: "#f7768e",
  successFg: "#9ece6a",

  // Diff
  diffAdded: "#9ece6a",
  diffRemoved: "#f7768e",
  diffContext: "#565f89",
} as const;

const thinkingBorderColors: Record<ThinkingLevel, string> = {
  off: colors.border,
  minimal: colors.dimFg,
  low: colors.cyan,
  medium: colors.blue,
  high: colors.magenta,
  xhigh: colors.orange,
};

export function getThinkingBorderColor(level: ThinkingLevel): string {
  return thinkingBorderColors[level];
}

export function createSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(colors.fg) },

    // Markdown
    "markup.heading.1": { fg: RGBA.fromHex(colors.blue), bold: true },
    "markup.heading.2": { fg: RGBA.fromHex(colors.blue), bold: true },
    "markup.heading.3": { fg: RGBA.fromHex(colors.cyan), bold: true },
    "markup.heading.4": { fg: RGBA.fromHex(colors.cyan) },
    "markup.heading.5": { fg: RGBA.fromHex(colors.cyan) },
    "markup.heading.6": { fg: RGBA.fromHex(colors.cyan) },
    "markup.bold": { fg: RGBA.fromHex(colors.orange), bold: true },
    "markup.italic": { fg: RGBA.fromHex(colors.magenta), italic: true },
    "markup.raw": { fg: RGBA.fromHex(colors.green) },
    "markup.raw.block": { fg: RGBA.fromHex(colors.fg) },
    "markup.link": { fg: RGBA.fromHex(colors.cyan), underline: true },
    "markup.link.url": { fg: RGBA.fromHex(colors.cyan), dim: true },
    "markup.list": { fg: RGBA.fromHex(colors.yellow) },

    // Code syntax
    keyword: { fg: RGBA.fromHex(colors.magenta) },
    "keyword.control": { fg: RGBA.fromHex(colors.magenta) },
    "keyword.function": { fg: RGBA.fromHex(colors.magenta) },
    "keyword.operator": { fg: RGBA.fromHex(colors.cyan) },
    "keyword.import": { fg: RGBA.fromHex(colors.magenta) },
    type: { fg: RGBA.fromHex(colors.cyan) },
    "type.builtin": { fg: RGBA.fromHex(colors.cyan) },
    function: { fg: RGBA.fromHex(colors.blue) },
    "function.method": { fg: RGBA.fromHex(colors.blue) },
    variable: { fg: RGBA.fromHex(colors.fg) },
    "variable.parameter": { fg: RGBA.fromHex(colors.orange) },
    "variable.builtin": { fg: RGBA.fromHex(colors.red) },
    string: { fg: RGBA.fromHex(colors.green) },
    "string.special": { fg: RGBA.fromHex(colors.green) },
    number: { fg: RGBA.fromHex(colors.orange) },
    comment: { fg: RGBA.fromHex(colors.dimFg), italic: true },
    operator: { fg: RGBA.fromHex(colors.cyan) },
    punctuation: { fg: RGBA.fromHex(colors.dimFg) },
    "punctuation.bracket": { fg: RGBA.fromHex(colors.fg) },
    "punctuation.delimiter": { fg: RGBA.fromHex(colors.dimFg) },
    constant: { fg: RGBA.fromHex(colors.orange) },
    "constant.builtin": { fg: RGBA.fromHex(colors.orange) },
    property: { fg: RGBA.fromHex(colors.cyan) },
    tag: { fg: RGBA.fromHex(colors.red) },
    attribute: { fg: RGBA.fromHex(colors.yellow) },
  });
}
