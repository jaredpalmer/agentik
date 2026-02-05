import { TextareaRenderable, type TextareaOptions, type CliRenderer } from "@opentui/core";

export type TextareaFieldOptions = Omit<TextareaOptions, "onSubmit" | "onContentChange"> & {
  onSubmitText?: (value: string) => void;
  onChangeText?: (value: string) => void;
};

export class TextareaField extends TextareaRenderable {
  constructor(renderer: CliRenderer, options: TextareaFieldOptions) {
    const { onSubmitText, onChangeText, ...rest } = options;
    super(renderer, rest);

    if (onSubmitText) {
      this.onSubmit = () => onSubmitText(this.plainText);
    }

    if (onChangeText) {
      this.editBuffer.on("content-changed", () => {
        onChangeText(this.plainText);
      });
    }
  }
}
