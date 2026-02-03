import { SyntaxStyle, type StyleDefinition, parseColor } from "@opentui/core";

const palette = {
  text: "#e6edf3",
  muted: "#9aa0a6",
  dim: "#6b7280",
  accent: "#7aa2b8",
  heading: "#9ecbff",
  headingAlt: "#8ab4f8",
  link: "#7dcfff",
  linkUrl: "#88c0d0",
  code: "#e5c07b",
  codeBg: "#1f2328",
  quote: "#a3d9a5",
  quoteBorder: "#3b4252",
  list: "#7aa2b8",
  hr: "#3b4252",
  warning: "#f0c674",
  error: "#cc6666",
  keyword: "#c792ea",
  string: "#a3d9a5",
  number: "#f0c674",
  function: "#9ecbff",
  type: "#89ddff",
  variable: "#e6edf3",
  operator: "#d19a66",
  punctuation: "#9aa0a6",
  comment: "#7f848e",
  constant: "#d19a66",
  tag: "#ff7ab2",
  attribute: "#f0c674",
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
  conceal: style({ fg: palette.quoteBorder, dim: true }),

  "markup.heading": style({ fg: palette.heading, bold: true }),
  "markup.heading.1": style({ fg: palette.heading, bold: true }),
  "markup.heading.2": style({ fg: palette.headingAlt, bold: true }),
  "markup.heading.3": style({ fg: palette.headingAlt, bold: true }),
  "markup.heading.4": style({ fg: palette.headingAlt, bold: true }),
  "markup.heading.5": style({ fg: palette.muted, bold: true }),
  "markup.heading.6": style({ fg: palette.muted, bold: true }),

  "markup.strong": style({ bold: true }),
  "markup.italic": style({ italic: true }),
  "markup.strikethrough": style({ dim: true }),

  "markup.link": style({ fg: palette.link }),
  "markup.link.label": style({ fg: palette.link, underline: true }),
  "markup.link.url": style({ fg: palette.linkUrl, dim: true }),

  "markup.raw": style({ fg: palette.code, bg: palette.codeBg }),
  "markup.raw.block": style({ fg: palette.code, bg: palette.codeBg }),

  "markup.list": style({ fg: palette.list }),

  "punctuation.special": style({ fg: palette.quoteBorder }),

  // Syntax highlight fallbacks used by code blocks.
  comment: style({ fg: palette.comment, italic: true }),
  keyword: style({ fg: palette.keyword, bold: true }),
  string: style({ fg: palette.string }),
  number: style({ fg: palette.number }),
  boolean: style({ fg: palette.number }),
  function: style({ fg: palette.function }),
  type: style({ fg: palette.type }),
  variable: style({ fg: palette.variable }),
  operator: style({ fg: palette.operator }),
  punctuation: style({ fg: palette.punctuation }),
  constant: style({ fg: palette.constant }),
  tag: style({ fg: palette.tag }),
  attribute: style({ fg: palette.attribute }),
  property: style({ fg: palette.function }),
  namespace: style({ fg: palette.type }),
  module: style({ fg: palette.type }),
  invalid: style({ fg: palette.error, underline: true }),
  warning: style({ fg: palette.warning, bold: true }),
};

let cachedMarkdownStyle: SyntaxStyle | undefined;

export function getDefaultMarkdownSyntaxStyle(): SyntaxStyle {
  if (!cachedMarkdownStyle) {
    cachedMarkdownStyle = SyntaxStyle.fromStyles(markdownStyles);
  }
  return cachedMarkdownStyle;
}
