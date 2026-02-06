/**
 * Command system types.
 *
 * Commands are slash-prefixed actions (e.g., `/help`, `/model`) that users
 * invoke from the TUI input. Extensions can register custom commands.
 */

/** Autocomplete suggestion for command arguments. */
export interface AutocompleteItem {
  value: string;
  label: string;
}

/** Context passed to command handlers. */
export interface CommandContext {
  /** Raw argument string after the command name. */
  args: string;
}

/** A registered command definition. */
export interface RegisteredCommand {
  name: string;
  description?: string;
  source?: SlashCommandSource;
  getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null;
  handler: (args: string, ctx: CommandContext) => Promise<void> | void;
}

/** Where the command was registered from. */
export type SlashCommandSource = "builtin" | "extension";

/** Info about an available slash command. */
export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: SlashCommandSource;
}

/** Result of parsing a slash command from user input. */
export interface ParsedSlashCommand {
  name: string;
  args: string;
}
