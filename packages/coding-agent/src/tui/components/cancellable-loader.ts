import type { KeyEvent } from "@opentui/core";
import { Loader } from "./loader";

export class CancellableLoader extends Loader {
  private abortController = new AbortController();

  onAbort?: () => void;

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get aborted(): boolean {
    return this.abortController.signal.aborted;
  }

  handleKey(key: KeyEvent): void {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      this.abortController.abort();
      this.onAbort?.();
    }
  }

  dispose(): void {
    this.stop();
  }
}
