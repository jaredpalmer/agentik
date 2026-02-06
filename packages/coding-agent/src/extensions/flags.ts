/**
 * CLI flags — extensions can register flags that users pass via CLI arguments.
 *
 * Flags have a name, type (boolean/string), optional default, and are
 * resolved at startup: defaults first, then CLI overrides.
 */

/** A registered CLI flag definition. */
export interface FlagDefinition {
  name: string;
  description?: string;
  type: "boolean" | "string";
  default?: boolean | string;
}

export class FlagRegistry {
  private definitions = new Map<string, FlagDefinition>();
  private values = new Map<string, boolean | string>();

  /** Register a flag. Throws if already registered. */
  register(name: string, options: Omit<FlagDefinition, "name">): () => void {
    if (this.definitions.has(name)) {
      throw new Error(`Flag "--${name}" is already registered`);
    }

    const def: FlagDefinition = { name, ...options };
    this.definitions.set(name, def);

    if (def.default !== undefined) {
      this.values.set(name, def.default);
    }

    return () => {
      this.definitions.delete(name);
      this.values.delete(name);
    };
  }

  /** Get a flag's current value. */
  get(name: string): boolean | string | undefined {
    return this.values.get(name);
  }

  /** Set a flag value (e.g., from CLI parsing). */
  set(name: string, value: boolean | string): void {
    this.values.set(name, value);
  }

  /** Check if a flag is registered. */
  has(name: string): boolean {
    return this.definitions.has(name);
  }

  /** Get all registered flag definitions. */
  listFlags(): FlagDefinition[] {
    return [...this.definitions.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Number of registered flags. */
  get size(): number {
    return this.definitions.size;
  }

  /**
   * Apply CLI arguments to registered flags.
   * Parses `--flag-name` (boolean true) and `--flag-name=value` (string).
   * Unknown flags are ignored.
   */
  applyCliArgs(args: string[]): void {
    for (const arg of args) {
      if (!arg.startsWith("--")) continue;

      const withoutDashes = arg.slice(2);
      const eqIdx = withoutDashes.indexOf("=");

      if (eqIdx === -1) {
        // Boolean flag: --flag-name
        const name = withoutDashes;
        const def = this.definitions.get(name);
        if (def && def.type === "boolean") {
          this.values.set(name, true);
        }
      } else {
        // String flag: --flag-name=value
        const name = withoutDashes.slice(0, eqIdx);
        const value = withoutDashes.slice(eqIdx + 1);
        const def = this.definitions.get(name);
        if (def) {
          if (def.type === "boolean") {
            this.values.set(name, value === "true" || value === "1");
          } else {
            this.values.set(name, value);
          }
        }
      }
    }
  }
}
