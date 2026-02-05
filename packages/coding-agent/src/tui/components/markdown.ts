import { MarkdownRenderable, type MarkdownOptions, type CliRenderer } from "@opentui/core";
import { getDefaultMarkdownSyntaxStyle } from "../markdown-theme";
import { resolvePadding, type PaddingOptions } from "./padding";

export type MarkdownBlockOptions = Omit<MarkdownOptions, "content" | "syntaxStyle"> &
  PaddingOptions & {
    content?: string;
    syntaxStyle?: MarkdownOptions["syntaxStyle"];
  };

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
