/**
 * Keyboard shortcuts — extensions can register key bindings.
 *
 * Each shortcut maps a key identifier (e.g., "ctrl+k", "f1") to a handler.
 * Reserved keys (used by the TUI core) cannot be overridden.
 */

/** Handler context for shortcuts. */
export interface ShortcutContext {
  /** The key that triggered the shortcut. */
  key: string;
}

/** A registered keyboard shortcut. */
export interface RegisteredShortcut {
  key: string;
  description?: string;
  handler: (ctx: ShortcutContext) => Promise<void> | void;
}

/** Reserved key actions that extensions cannot override. */
const RESERVED_KEYS = new Set([
  "ctrl+c",
  "ctrl+d",
  "ctrl+l",
  "escape",
  "enter",
  "shift+enter",
  "up",
  "down",
  "tab",
  "shift+tab",
]);

export class ShortcutRegistry {
  private shortcuts = new Map<string, RegisteredShortcut>();

  /** Register a keyboard shortcut. Throws if key is reserved or taken. */
  register(key: string, options: Omit<RegisteredShortcut, "key">): () => void {
    const normalized = normalizeKey(key);

    if (RESERVED_KEYS.has(normalized)) {
      throw new Error(`Key "${key}" is reserved and cannot be overridden by extensions`);
    }

    if (this.shortcuts.has(normalized)) {
      throw new Error(`Key "${key}" is already registered`);
    }

    const shortcut: RegisteredShortcut = { key: normalized, ...options };
    this.shortcuts.set(normalized, shortcut);

    return () => {
      this.shortcuts.delete(normalized);
    };
  }

  /** Get a shortcut by key. */
  get(key: string): RegisteredShortcut | undefined {
    return this.shortcuts.get(normalizeKey(key));
  }

  /** Check if a key has a registered shortcut. */
  has(key: string): boolean {
    return this.shortcuts.has(normalizeKey(key));
  }

  /** Execute a shortcut handler. Returns false if not found. */
  async execute(key: string): Promise<boolean> {
    const shortcut = this.shortcuts.get(normalizeKey(key));
    if (!shortcut) return false;

    const ctx: ShortcutContext = { key: normalizeKey(key) };
    await shortcut.handler(ctx);
    return true;
  }

  /** List all registered shortcuts. */
  listShortcuts(): RegisteredShortcut[] {
    return [...this.shortcuts.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Check if a key is reserved. */
  static isReserved(key: string): boolean {
    return RESERVED_KEYS.has(normalizeKey(key));
  }

  /** Number of registered shortcuts. */
  get size(): number {
    return this.shortcuts.size;
  }
}

/** Normalize key identifiers: lowercase, consistent ordering. */
function normalizeKey(key: string): string {
  return key.toLowerCase().trim();
}
