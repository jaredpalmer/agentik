import { describe, expect, it } from "bun:test";
import { Agent, type Extension } from "@agentik/agent";
import { createMockModel } from "../../agent/test/utils/mock-model.js";
import { CommandRegistry } from "../src/commands/index.js";
import {
  createCodingExtensionAPI,
  type CodingExtensionAPI,
} from "../src/extensions/coding-extension-api.js";
import { createEventBus } from "../src/extensions/event-bus.js";
import { FlagRegistry } from "../src/extensions/flags.js";
import { MessageRendererRegistry } from "../src/extensions/message-renderer.js";
import { ProviderRegistry } from "../src/extensions/providers.js";
import { ShortcutRegistry } from "../src/extensions/shortcuts.js";
import { NoopUIContext } from "../src/extensions/ui-context.js";

function createTestAPI(): {
  agent: Agent;
  codingApi: CodingExtensionAPI;
  commandRegistry: CommandRegistry;
  flagRegistry: FlagRegistry;
  shortcutRegistry: ShortcutRegistry;
  providerRegistry: ProviderRegistry;
  messageRendererRegistry: MessageRendererRegistry;
} {
  const model = createMockModel([{ text: "hi" }]);
  const agent = new Agent({ initialState: { model } });

  const commandRegistry = new CommandRegistry();
  const flagRegistry = new FlagRegistry();
  const shortcutRegistry = new ShortcutRegistry();
  const providerRegistry = new ProviderRegistry();
  const messageRendererRegistry = new MessageRendererRegistry();
  const eventBus = createEventBus();
  const ui = new NoopUIContext();

  let coreApi: import("@agentik/agent").ExtensionAPI | undefined;
  const ext: Extension = (api) => {
    coreApi = api;
  };
  agent.use(ext);

  const codingApi = createCodingExtensionAPI({
    coreApi: coreApi!,
    ui,
    commandRegistry,
    flagRegistry,
    shortcutRegistry,
    providerRegistry,
    messageRendererRegistry,
    eventBus,
  });

  return {
    agent,
    codingApi,
    commandRegistry,
    flagRegistry,
    shortcutRegistry,
    providerRegistry,
    messageRendererRegistry,
  };
}

describe("CodingExtensionAPI", () => {
  it("should expose core state", () => {
    const { codingApi } = createTestAPI();
    expect(codingApi.state).toBeDefined();
    expect(codingApi.state.messages).toBeArray();
  });

  it("should delegate getActiveTools to core", () => {
    const { codingApi } = createTestAPI();
    const tools = codingApi.getActiveTools();
    expect(tools).toBeArray();
  });

  it("should delegate thinking level to core", () => {
    const { codingApi } = createTestAPI();
    codingApi.setThinkingLevel("high");
    expect(codingApi.getThinkingLevel()).toBe("high");
  });

  it("should expose UI context", () => {
    const { codingApi } = createTestAPI();
    expect(codingApi.ui).toBeDefined();
  });

  it("should register commands via CodingExtensionAPI", () => {
    const { codingApi, commandRegistry } = createTestAPI();
    codingApi.registerCommand("test", {
      description: "Test command",
      handler: () => {},
    });

    expect(commandRegistry.has("test")).toBe(true);
  });

  it("should get commands via CodingExtensionAPI", () => {
    const { codingApi } = createTestAPI();
    codingApi.registerCommand("myCmd", {
      description: "My command",
      handler: () => {},
    });

    const commands = codingApi.getCommands();
    expect(commands.find((c) => c.name === "myCmd")).toBeDefined();
  });

  it("should register shortcuts via CodingExtensionAPI", () => {
    const { codingApi, shortcutRegistry } = createTestAPI();
    codingApi.registerShortcut("ctrl+k", {
      description: "Quick action",
      handler: () => {},
    });

    expect(shortcutRegistry.has("ctrl+k")).toBe(true);
  });

  it("should register flags via CodingExtensionAPI", () => {
    const { codingApi, flagRegistry } = createTestAPI();
    codingApi.registerFlag("verbose", {
      type: "boolean",
      default: false,
    });

    expect(flagRegistry.has("verbose")).toBe(true);
  });

  it("should get flag values via CodingExtensionAPI", () => {
    const { codingApi } = createTestAPI();
    codingApi.registerFlag("output", {
      type: "string",
      default: "json",
    });

    expect(codingApi.getFlag("output")).toBe("json");
  });

  it("should register providers via CodingExtensionAPI", () => {
    const { codingApi, providerRegistry } = createTestAPI();
    codingApi.registerProvider("my-proxy", {
      baseUrl: "https://proxy.example.com",
      models: [{ name: "custom-model" }],
    });

    expect(providerRegistry.has("my-proxy")).toBe(true);
  });

  it("should register message renderers via CodingExtensionAPI", () => {
    const { codingApi, messageRendererRegistry } = createTestAPI();
    codingApi.registerMessageRenderer("status", (msg) => {
      return [`Status: ${msg.content}`];
    });

    expect(messageRendererRegistry.has("status")).toBe(true);
  });

  it("should append entries via CodingExtensionAPI", () => {
    let appended: { customType: string; data: unknown } | undefined;

    const model = createMockModel([{ text: "hi" }]);
    const agent = new Agent({ initialState: { model } });

    let coreApi: import("@agentik/agent").ExtensionAPI | undefined;
    const ext: Extension = (api) => {
      coreApi = api;
    };
    agent.use(ext);

    const codingApi = createCodingExtensionAPI({
      coreApi: coreApi!,
      ui: new NoopUIContext(),
      commandRegistry: new CommandRegistry(),
      flagRegistry: new FlagRegistry(),
      shortcutRegistry: new ShortcutRegistry(),
      providerRegistry: new ProviderRegistry(),
      messageRendererRegistry: new MessageRendererRegistry(),
      eventBus: createEventBus(),
      onAppendEntry: (customType, data) => {
        appended = { customType, data };
      },
    });

    codingApi.appendEntry("bookmark", { position: 42 });
    expect(appended).toEqual({
      customType: "bookmark",
      data: { position: 42 },
    });
  });

  it("should expose event bus", () => {
    const { codingApi } = createTestAPI();
    let received: unknown;

    codingApi.events.on("ext:test", (data) => {
      received = data;
    });
    codingApi.events.emit("ext:test", { hello: true });

    expect(received).toEqual({ hello: true });
  });

  it("should register tool via core delegation", () => {
    const { codingApi, agent } = createTestAPI();

    codingApi.registerTool({
      name: "custom-tool",
      description: "A custom tool",
      parameters: {} as import("zod").ZodType,
      execute: async () => ({ content: "done" }),
    });

    expect(agent.state.tools.find((t) => t.name === "custom-tool")).toBeDefined();
  });
});
