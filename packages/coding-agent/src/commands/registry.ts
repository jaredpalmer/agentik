/**
 * CommandRegistry — manages slash command registration and dispatch.
 *
 * Commands are registered by name and dispatched via `execute()`.
 * A built-in `/help` command is always available.
 */

import type {
  AutocompleteItem,
  CommandContext,
  ParsedSlashCommand,
  RegisteredCommand,
  SlashCommandInfo,
} from "./types.js";

/**
 * Parse user input as a slash command.
 * Returns null if the input is not a slash command.
 *
 * Examples:
 *   "/help"        -> { name: "help", args: "" }
 *   "/model gpt-4" -> { name: "model", args: "gpt-4" }
 *   "hello"        -> null
 *   "/ "           -> null
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const withoutSlash = trimmed.slice(1);
  if (withoutSlash.length === 0 || withoutSlash[0] === " ") return null;

  const spaceIdx = withoutSlash.indexOf(" ");
  if (spaceIdx === -1) {
    return { name: withoutSlash, args: "" };
  }

  return {
    name: withoutSlash.slice(0, spaceIdx),
    args: withoutSlash.slice(spaceIdx + 1).trim(),
  };
}

export class CommandRegistry {
  private commands = new Map<string, RegisteredCommand>();

  constructor() {
    this.registerBuiltinHelp();
  }

  /** Register a command. Throws if name is already taken. */
  register(name: string, options: Omit<RegisteredCommand, "name">): () => void {
    if (this.commands.has(name)) {
      throw new Error(`Command "/${name}" is already registered`);
    }

    const command: RegisteredCommand = { name, ...options };
    this.commands.set(name, command);

    return () => {
      this.commands.delete(name);
    };
  }

  /** Get a command by name. */
  get(name: string): RegisteredCommand | undefined {
    return this.commands.get(name);
  }

  /** Check if a command is registered. */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /** Execute a command by name. Returns false if not found. */
  async execute(name: string, args: string): Promise<boolean> {
    const command = this.commands.get(name);
    if (!command) return false;

    const ctx: CommandContext = { args };
    try {
      await command.handler(args, ctx);
    } catch (err) {
      console.error(`Command "/${name}" error:`, err);
    }
    return true;
  }

  /** Get completions for a command's arguments. */
  getCompletions(name: string, prefix: string): AutocompleteItem[] | null {
    const command = this.commands.get(name);
    if (!command?.getArgumentCompletions) return null;
    return command.getArgumentCompletions(prefix);
  }

  /** List all registered commands as SlashCommandInfo. */
  listCommands(): SlashCommandInfo[] {
    const result: SlashCommandInfo[] = [];
    for (const cmd of this.commands.values()) {
      result.push({
        name: cmd.name,
        description: cmd.description,
        source: cmd.source ?? "extension",
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Number of registered commands. */
  get size(): number {
    return this.commands.size;
  }

  private registerBuiltinHelp(): void {
    this.commands.set("help", {
      name: "help",
      description: "List available commands",
      source: "builtin",
      handler: () => {
        const commands = this.listCommands();
        const lines = commands.map((c) => {
          const desc = c.description ? ` — ${c.description}` : "";
          return `  /${c.name}${desc}`;
        });
        console.log("Available commands:\n" + lines.join("\n"));
      },
    });
  }
}
