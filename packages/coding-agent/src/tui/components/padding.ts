export type PaddingValue = number | `${number}%`;

export type PaddingOptions = {
  paddingX?: number;
  paddingY?: number;
  paddingLeft?: PaddingValue;
  paddingRight?: PaddingValue;
  paddingTop?: PaddingValue;
  paddingBottom?: PaddingValue;
};

export function resolvePadding(options: PaddingOptions): Partial<PaddingOptions> {
  const resolved: Partial<PaddingOptions> = {};

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
