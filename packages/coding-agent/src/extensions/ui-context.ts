/**
 * UI context for extensions — provides interactive UI primitives.
 *
 * Each mode (interactive TUI, headless, etc.) provides its own implementation.
 * Extensions interact via the same interface regardless of mode.
 */

/** Options for extension UI dialogs. */
export interface UIDialogOptions {
  signal?: AbortSignal;
  timeout?: number;
}

/**
 * UI context interface for extensions.
 * Provides dialogs, notifications, status bar, and widgets.
 */
export interface ExtensionUIContext {
  /** Show a selector and return the user's choice. */
  select(title: string, options: string[], opts?: UIDialogOptions): Promise<string | undefined>;

  /** Show a confirmation dialog. */
  confirm(title: string, message: string, opts?: UIDialogOptions): Promise<boolean>;

  /** Show a text input dialog. */
  input(title: string, placeholder?: string, opts?: UIDialogOptions): Promise<string | undefined>;

  /** Show a notification to the user. */
  notify(message: string, type?: "info" | "warning" | "error"): void;

  /** Set status text in the footer/status bar. Pass undefined to clear. */
  setStatus(key: string, text: string | undefined): void;

  /** Set a widget to display. Accepts string array or undefined to clear. */
  setWidget(key: string, content: string[] | undefined): void;

  /** Set the terminal window/tab title. */
  setTitle(title: string): void;
}

/**
 * No-op implementation for non-interactive modes (headless, testing, etc.).
 * All dialogs resolve immediately with default/undefined values.
 */
export class NoopUIContext implements ExtensionUIContext {
  async select(): Promise<string | undefined> {
    return undefined;
  }

  async confirm(): Promise<boolean> {
    return false;
  }

  async input(): Promise<string | undefined> {
    return undefined;
  }

  notify(): void {}

  setStatus(): void {}

  setWidget(): void {}

  setTitle(): void {}
}
