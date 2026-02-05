import { BoxRenderable, type BoxOptions, type CliRenderer } from "@opentui/core";
import { resolvePadding, type PaddingOptions } from "./padding";

export interface BoxProps extends BoxOptions, PaddingOptions {}

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
