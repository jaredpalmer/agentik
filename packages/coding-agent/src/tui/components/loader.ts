import { TextRenderable, type CliRenderer, fg, t, type StyledText } from "@opentui/core";

export type LoaderOptions = {
  message?: string;
  frames?: string[];
  intervalMs?: number;
  frameColor?: string;
  messageColor?: string;
  content?: (frame: string, message: string) => StyledText;
};

export class Loader {
  readonly view: TextRenderable;

  private renderer: CliRenderer;
  private frames: string[];
  private intervalMs: number;
  private frameColor: string;
  private messageColor: string;
  private content?: (frame: string, message: string) => StyledText;
  private currentFrame = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private message: string;

  constructor(renderer: CliRenderer, options: LoaderOptions = {}) {
    this.renderer = renderer;
    this.frames =
      options.frames && options.frames.length > 0 ? options.frames : ["|", "/", "-", "\\"];
    this.intervalMs = options.intervalMs ?? 80;
    this.frameColor = options.frameColor ?? "#7aa2b8";
    this.messageColor = options.messageColor ?? "#9aa0a6";
    this.content = options.content;
    this.message = options.message ?? "Loading...";

    this.view = new TextRenderable(renderer, {
      content: "",
      wrapMode: "none",
      height: 1,
    });

    this.start();
  }

  start(): void {
    if (this.intervalId) {
      return;
    }
    this.updateDisplay();
    this.intervalId = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      this.updateDisplay();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  setMessage(message: string): void {
    this.message = message;
    this.updateDisplay();
  }

  destroy(): void {
    this.stop();
    this.view.destroy();
  }

  private updateDisplay(): void {
    const frame = this.frames[this.currentFrame] ?? "";
    if (this.content) {
      this.view.content = this.content(frame, this.message);
    } else {
      const styled = t`${fg(this.frameColor)(frame)} ${fg(this.messageColor)(this.message)}`;
      this.view.content = styled;
    }
    this.renderer.requestRender();
  }
}
