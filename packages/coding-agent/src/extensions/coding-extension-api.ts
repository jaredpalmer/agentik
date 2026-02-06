/**
 * CodingExtensionAPI — unified API for coding-agent extensions.
 *
 * Extends the core ExtensionAPI with coding-agent-specific features:
 * commands, shortcuts, flags, UI, providers, event bus, message rendering.
 *
 * This is what extension factories receive when loaded by the coding-agent.
 */

import type { ExtensionAPI } from "@agentik/agent";
import type { CommandRegistry } from "../commands/index.js";
import type { EventBus } from "./event-bus.js";
import type { FlagRegistry } from "./flags.js";
import type { MessageRendererFn } from "./message-renderer.js";
import type { ProviderConfig } from "./providers.js";
import type { RegisteredCommand, SlashCommandInfo } from "../commands/types.js";
import type { ShortcutContext } from "./shortcuts.js";
import type { ExtensionUIContext } from "./ui-context.js";

/**
 * Extended extension API for the coding-agent.
 * Includes all core Agent features plus coding-agent-specific additions.
 */
export interface CodingExtensionAPI extends ExtensionAPI {
  // =========================================================================
  // UI Context
  // =========================================================================

  /** UI primitives for interactive extensions. */
  readonly ui: ExtensionUIContext;

  // =========================================================================
  // Commands
  // =========================================================================

  /** Register a slash command. */
  registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void;

  /** Get all available slash commands. */
  getCommands(): SlashCommandInfo[];

  // =========================================================================
  // Keyboard Shortcuts
  // =========================================================================

  /** Register a keyboard shortcut. */
  registerShortcut(
    key: string,
    options: {
      description?: string;
      handler: (ctx: ShortcutContext) => Promise<void> | void;
    }
  ): void;

  // =========================================================================
  // CLI Flags
  // =========================================================================

  /** Register a CLI flag. */
  registerFlag(
    name: string,
    options: {
      description?: string;
      type: "boolean" | "string";
      default?: boolean | string;
    }
  ): void;

  /** Get the value of a registered CLI flag. */
  getFlag(name: string): boolean | string | undefined;

  // =========================================================================
  // Provider Registration
  // =========================================================================

  /** Register or override a model provider. */
  registerProvider(name: string, config: ProviderConfig): void;

  // =========================================================================
  // Message Rendering
  // =========================================================================

  /** Register a custom renderer for a custom message type. */
  registerMessageRenderer<T = unknown>(customType: string, renderer: MessageRendererFn<T>): void;

  /** Append a custom entry to the session (not sent to LLM). */
  appendEntry<T = unknown>(customType: string, data?: T): void;

  // =========================================================================
  // Event Bus
  // =========================================================================

  /** Shared event bus for inter-extension communication. */
  readonly events: EventBus;
}

/** Options for creating a CodingExtensionAPI wrapper. */
export interface CodingExtensionAPIOptions {
  coreApi: ExtensionAPI;
  ui: ExtensionUIContext;
  commandRegistry: CommandRegistry;
  flagRegistry: FlagRegistry;
  shortcutRegistry: import("./shortcuts.js").ShortcutRegistry;
  providerRegistry: import("./providers.js").ProviderRegistry;
  messageRendererRegistry: import("./message-renderer.js").MessageRendererRegistry;
  eventBus: EventBus;
  onAppendEntry?: <T = unknown>(customType: string, data?: T) => void;
}

/**
 * Create a CodingExtensionAPI that wraps a core ExtensionAPI
 * and adds coding-agent-specific registries.
 */
export function createCodingExtensionAPI(options: CodingExtensionAPIOptions): CodingExtensionAPI {
  const {
    coreApi,
    ui,
    commandRegistry,
    flagRegistry,
    shortcutRegistry,
    providerRegistry,
    messageRendererRegistry,
    eventBus,
    onAppendEntry,
  } = options;

  return {
    // Delegate core ExtensionAPI methods
    get state() {
      return coreApi.state;
    },
    registerTool: coreApi.registerTool.bind(coreApi),
    unregisterTool: coreApi.unregisterTool.bind(coreApi),
    getActiveTools: coreApi.getActiveTools.bind(coreApi),
    setActiveTools: coreApi.setActiveTools.bind(coreApi),
    on: coreApi.on.bind(coreApi),
    steer: coreApi.steer.bind(coreApi),
    followUp: coreApi.followUp.bind(coreApi),
    sendUserMessage: coreApi.sendUserMessage.bind(coreApi),
    setModel: coreApi.setModel.bind(coreApi),
    getThinkingLevel: coreApi.getThinkingLevel.bind(coreApi),
    setThinkingLevel: coreApi.setThinkingLevel.bind(coreApi),

    // Coding-agent additions
    ui,
    events: eventBus,

    registerCommand(name, opts) {
      commandRegistry.register(name, opts);
    },

    getCommands() {
      return commandRegistry.listCommands();
    },

    registerShortcut(key, opts) {
      shortcutRegistry.register(key, opts);
    },

    registerFlag(name, opts) {
      flagRegistry.register(name, opts);
    },

    getFlag(name) {
      return flagRegistry.get(name);
    },

    registerProvider(name, config) {
      providerRegistry.register(name, config);
    },

    registerMessageRenderer(customType, renderer) {
      messageRendererRegistry.register(customType, renderer);
    },

    appendEntry(customType, data) {
      onAppendEntry?.(customType, data);
    },
  };
}
