import { MarkdownRenderable, type MarkdownOptions, type CliRenderer } from "@opentui/core";
import { getDefaultMarkdownSyntaxStyle } from "../markdown-theme";

type MarkdownPaddingOptions = {
  paddingX?: number;
  paddingY?: number;
  paddingLeft?: number | `${number}%`;
  paddingRight?: number | `${number}%`;
  paddingTop?: number | `${number}%`;
  paddingBottom?: number | `${number}%`;
};

export type MarkdownBlockOptions = Omit<MarkdownOptions, "content" | "syntaxStyle"> &
  MarkdownPaddingOptions & {
    content?: string;
    syntaxStyle?: MarkdownOptions["syntaxStyle"];
  };

function resolvePadding(options: MarkdownPaddingOptions): Partial<MarkdownPaddingOptions> {
  const resolved: Partial<MarkdownPaddingOptions> = {};

  const left = options.paddingLeft ?? options.paddingX;
  const right = options.paddingRight ?? options.paddingX;
  const top = options.paddingTop ?? options.paddingY;
  const bottom = options.paddingBottom ?? options.paddingY;

  if (left !== undefined) {
    resolved.paddingLeft = left;
  }
  if (right !== undefined) {
    resolved.paddingRight = right;
  }
  if (top !== undefined) {
    resolved.paddingTop = top;
  }
  if (bottom !== undefined) {
    resolved.paddingBottom = bottom;
  }

  return resolved;
}

export class MarkdownBlock extends MarkdownRenderable {
  constructor(renderer: CliRenderer, options: MarkdownBlockOptions = {}) {
    const {
      content,
      syntaxStyle,
      paddingX,
      paddingY,
      paddingLeft,
      paddingRight,
      paddingTop,
      paddingBottom,
      ...rest
    } = options;

    const padding = resolvePadding({
      paddingX,
      paddingY,
      paddingLeft,
      paddingRight,
      paddingTop,
      paddingBottom,
    });

    super(renderer, {
      ...rest,
      ...padding,
      content: content ?? "",
      syntaxStyle: syntaxStyle ?? getDefaultMarkdownSyntaxStyle(),
    });
  }

  setContent(content: string): void {
    this.content = content;
  }
}
