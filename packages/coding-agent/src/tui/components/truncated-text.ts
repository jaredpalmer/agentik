import { TextRenderable, type TextOptions, type CliRenderer, type StyledText } from "@opentui/core";
import { resolvePadding, type PaddingOptions } from "./padding";

export type TruncatedTextOptions = Omit<TextOptions, "content" | "wrapMode" | "truncate"> &
  PaddingOptions & {
    text?: string | StyledText;
  };

export class TruncatedText extends TextRenderable {
  constructor(renderer: CliRenderer, options: TruncatedTextOptions = {}) {
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
      wrapMode: "none",
      truncate: true,
      height: 1,
    });
  }

  setText(text: string | StyledText): void {
    this.content = text;
  }
}
