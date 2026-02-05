import { SyntaxStyle, type StyleDefinition, parseColor } from "@opentui/core";
import { colors } from "./theme";

const palette = {
  text: undefined as string | undefined,
  muted: colors.muted,
  dim: colors.dim,
  accent: colors.accent,
  heading: colors.codex,
  error: colors.error,
  success: colors.success,
};

function style(options: {
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
}): StyleDefinition {
  return {
    ...(options.fg ? { fg: parseColor(options.fg) } : {}),
    ...(options.bg ? { bg: parseColor(options.bg) } : {}),
    ...(options.bold !== undefined ? { bold: options.bold } : {}),
    ...(options.italic !== undefined ? { italic: options.italic } : {}),
    ...(options.underline !== undefined ? { underline: options.underline } : {}),
    ...(options.dim !== undefined ? { dim: options.dim } : {}),
  };
}

const markdownStyles: Record<string, StyleDefinition> = {
  default: style({ fg: palette.text }),
  conceal: style({ dim: true }),

  "markup.heading": style({ fg: palette.heading, bold: true }),
  "markup.heading.1": style({ fg: palette.heading, bold: true }),
  "markup.heading.2": style({ fg: palette.heading, bold: true }),
  "markup.heading.3": style({ fg: palette.heading, bold: true }),
  "markup.heading.4": style({ fg: palette.heading, bold: true }),
  "markup.heading.5": style({ fg: palette.muted, bold: true }),
  "markup.heading.6": style({ fg: palette.muted, bold: true }),

  "markup.strong": style({ bold: true }),
  "markup.italic": style({ italic: true }),
  "markup.strikethrough": style({ dim: true }),

  "markup.link": style({ fg: palette.accent }),
  "markup.link.label": style({ fg: palette.accent, underline: true }),
  "markup.link.url": style({ dim: true }),

  "markup.raw": style({ dim: true }),
  "markup.raw.block": style({ dim: true }),

  "markup.list": style({ dim: true }),

  "punctuation.special": style({ dim: true }),

  // Syntax highlight fallbacks used by code blocks.
  comment: style({ dim: true, italic: true }),
  keyword: style({ fg: palette.heading, bold: true }),
  string: style({ fg: palette.success }),
  number: style({ fg: palette.accent }),
  boolean: style({ fg: palette.accent }),
  function: style({ fg: palette.accent }),
  type: style({ fg: palette.accent }),
  variable: style({ fg: palette.text }),
  operator: style({ fg: palette.text }),
  punctuation: style({ dim: true }),
  constant: style({ fg: palette.heading }),
  tag: style({ fg: palette.accent }),
  attribute: style({ fg: palette.accent }),
  property: style({ fg: palette.accent }),
  namespace: style({ fg: palette.accent }),
  module: style({ fg: palette.accent }),
  invalid: style({ fg: palette.error, underline: true }),
  warning: style({ fg: palette.error, bold: true }),
};

let cachedMarkdownStyle: SyntaxStyle | undefined;

export function getDefaultMarkdownSyntaxStyle(): SyntaxStyle {
  if (!cachedMarkdownStyle) {
    cachedMarkdownStyle = SyntaxStyle.fromStyles(markdownStyles);
  }
  return cachedMarkdownStyle;
}
