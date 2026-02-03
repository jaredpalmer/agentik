import { BoxRenderable, type BoxOptions, type CliRenderer } from "@opentui/core";

type BoxPaddingOptions = {
  paddingX?: number;
  paddingY?: number;
  paddingLeft?: number | `${number}%`;
  paddingRight?: number | `${number}%`;
  paddingTop?: number | `${number}%`;
  paddingBottom?: number | `${number}%`;
};

export interface BoxProps extends BoxOptions, BoxPaddingOptions {}

function resolvePadding(options: BoxPaddingOptions): Partial<BoxPaddingOptions> {
  const resolved: Partial<BoxPaddingOptions> = {};

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

export class Box extends BoxRenderable {
  constructor(renderer: CliRenderer, options: BoxProps = {}) {
    const { paddingX, paddingY, paddingLeft, paddingRight, paddingTop, paddingBottom, ...rest } =
      options;
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
    });
  }
}
