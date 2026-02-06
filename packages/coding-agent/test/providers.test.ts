import { describe, expect, it } from "bun:test";
import { ProviderRegistry } from "../src/extensions/providers.js";

describe("ProviderRegistry", () => {
  it("should register a provider", () => {
    const registry = new ProviderRegistry();
    registry.register("openai", {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      models: [{ name: "gpt-4" }],
    });

    expect(registry.has("openai")).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("should get a registered provider", () => {
    const registry = new ProviderRegistry();
    registry.register("anthropic", {
      baseUrl: "https://api.anthropic.com",
      models: [{ name: "claude-3-opus", supportsThinking: true }, { name: "claude-3-sonnet" }],
    });

    const provider = registry.get("anthropic");
    expect(provider).toBeDefined();
    expect(provider!.name).toBe("anthropic");
    expect(provider!.config.models).toHaveLength(2);
  });

  it("should return undefined for unknown provider", () => {
    const registry = new ProviderRegistry();
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("should allow updating a provider (re-register)", () => {
    const registry = new ProviderRegistry();
    registry.register("openai", { baseUrl: "https://old.api.com" });
    registry.register("openai", { baseUrl: "https://new.api.com" });

    expect(registry.size).toBe(1);
    expect(registry.get("openai")!.config.baseUrl).toBe("https://new.api.com");
  });

  it("should unregister via returned dispose function", () => {
    const registry = new ProviderRegistry();
    const dispose = registry.register("openai", {});

    expect(registry.has("openai")).toBe(true);
    dispose();
    expect(registry.has("openai")).toBe(false);
  });

  it("should list all providers sorted by name", () => {
    const registry = new ProviderRegistry();
    registry.register("openai", {});
    registry.register("anthropic", {});
    registry.register("google", {});

    const list = registry.listProviders();
    expect(list).toHaveLength(3);
    expect(list[0].name).toBe("anthropic");
    expect(list[1].name).toBe("google");
    expect(list[2].name).toBe("openai");
  });

  it("should support custom headers", () => {
    const registry = new ProviderRegistry();
    registry.register("proxy", {
      baseUrl: "https://proxy.example.com",
      headers: { "X-Custom-Header": "value" },
    });

    const provider = registry.get("proxy");
    expect(provider!.config.headers).toEqual({
      "X-Custom-Header": "value",
    });
  });
});
