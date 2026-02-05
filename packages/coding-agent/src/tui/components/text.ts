import { TextRenderable, type TextOptions, type CliRenderer, type StyledText } from "@opentui/core";
import { resolvePadding, type PaddingOptions } from "./padding";

export type TextBlockOptions = Omit<TextOptions, "content"> &
  PaddingOptions & {
    text?: string | StyledText;
  };

export class TextBlock extends TextRenderable {
  constructor(renderer: CliRenderer, options: TextBlockOptions = {}) {
    const {
      text,
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
      content: text ?? "",
    });
  }

  setText(text: string | StyledText): void {
    this.content = text;
  }
}
