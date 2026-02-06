export { bashGuard } from "./bash-guard.js";
export { toolLogger, type ToolLogEntry, type ToolLoggerOptions } from "./tool-logger.js";
export { contextInfo, type ContextInfoOptions } from "./context-info.js";
export {
  discoverExtensions,
  discoverAndLoadExtensions,
  loadExtensions,
  type ExtensionFactory,
  type LoadedExtension,
  type LoadExtensionsResult,
} from "./loader.js";
export { FlagRegistry, type FlagDefinition } from "./flags.js";
export { ShortcutRegistry, type RegisteredShortcut, type ShortcutContext } from "./shortcuts.js";
export { NoopUIContext, type ExtensionUIContext, type UIDialogOptions } from "./ui-context.js";
export { createEventBus, type EventBus, type EventBusController } from "./event-bus.js";
export {
  ProviderRegistry,
  type ModelConfig,
  type ProviderConfig,
  type RegisteredProvider,
} from "./providers.js";
export {
  MessageRendererRegistry,
  type CustomMessageData,
  type MessageRendererFn,
  type MessageRenderOptions,
} from "./message-renderer.js";
export {
  createCodingExtensionAPI,
  type CodingExtensionAPI,
  type CodingExtensionAPIOptions,
} from "./coding-extension-api.js";
