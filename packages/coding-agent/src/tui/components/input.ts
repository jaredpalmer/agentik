import {
  InputRenderable,
  InputRenderableEvents,
  type InputRenderableOptions,
  type CliRenderer,
} from "@opentui/core";

export interface InputFieldOptions extends Omit<InputRenderableOptions, "onSubmit"> {
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
  onInput?: (value: string) => void;
}

export class InputField extends InputRenderable {
  constructor(renderer: CliRenderer, options: InputFieldOptions) {
    const { onSubmit, onChange, onInput, ...rest } = options;
    super(renderer, rest);

    if (onSubmit) {
      this.on(InputRenderableEvents.ENTER, onSubmit);
    }
    if (onChange) {
      this.on(InputRenderableEvents.CHANGE, onChange);
    }
    if (onInput) {
      this.on(InputRenderableEvents.INPUT, onInput);
    }
  }
}
