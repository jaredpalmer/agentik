import { TextRenderable, type TextOptions, type CliRenderer, type StyledText } from "@opentui/core";

type TruncatedPaddingOptions = {
  paddingX?: number;
  paddingY?: number;
  paddingLeft?: number | `${number}%`;
  paddingRight?: number | `${number}%`;
  paddingTop?: number | `${number}%`;
  paddingBottom?: number | `${number}%`;
};

export type TruncatedTextOptions = Omit<TextOptions, "content" | "wrapMode" | "truncate"> &
  TruncatedPaddingOptions & {
    text?: string | StyledText;
  };

function resolvePadding(options: TruncatedPaddingOptions): Partial<TruncatedPaddingOptions> {
  const resolved: Partial<TruncatedPaddingOptions> = {};

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
