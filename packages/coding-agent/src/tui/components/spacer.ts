import { BoxRenderable, type CliRenderer } from "@opentui/core";

export class Spacer extends BoxRenderable {
  constructor(renderer: CliRenderer, lines: number = 1) {
    super(renderer, {
      width: "100%",
      height: lines,
      shouldFill: false,
    });
  }

  setLines(lines: number): void {
    this.height = lines;
  }
}
