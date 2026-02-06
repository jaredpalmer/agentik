import { describe, expect, it } from "bun:test";
import { CommandRegistry, parseSlashCommand } from "../src/commands/index.js";

describe("parseSlashCommand", () => {
  it("should parse a simple command", () => {
    const result = parseSlashCommand("/help");
    expect(result).toEqual({ name: "help", args: "" });
  });

  it("should parse a command with arguments", () => {
    const result = parseSlashCommand("/model gpt-4");
    expect(result).toEqual({ name: "model", args: "gpt-4" });
  });

  it("should parse a command with multiple argument words", () => {
    const result = parseSlashCommand("/search hello world foo");
    expect(result).toEqual({ name: "search", args: "hello world foo" });
  });

  it("should trim whitespace around input", () => {
    const result = parseSlashCommand("  /help  ");
    expect(result).toEqual({ name: "help", args: "" });
  });

  it("should trim whitespace in arguments", () => {
    const result = parseSlashCommand("/model   gpt-4  ");
    expect(result).toEqual({ name: "model", args: "gpt-4" });
  });

  it("should return null for non-command input", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
    expect(parseSlashCommand("   ")).toBeNull();
  });

  it("should return null for slash followed by space", () => {
    expect(parseSlashCommand("/ ")).toBeNull();
    expect(parseSlashCommand("/")).toBeNull();
  });
});

describe("CommandRegistry", () => {
  it("should have built-in /help command", () => {
    const registry = new CommandRegistry();
    expect(registry.has("help")).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("should register a command", () => {
    const registry = new CommandRegistry();
    registry.register("test", {
      description: "A test command",
      handler: () => {},
    });

    expect(registry.has("test")).toBe(true);
    expect(registry.size).toBe(2); // help + test
  });

  it("should throw on duplicate registration", () => {
    const registry = new CommandRegistry();
    registry.register("test", { handler: () => {} });

    expect(() => {
      registry.register("test", { handler: () => {} });
    }).toThrow('Command "/test" is already registered');
  });

  it("should unregister via returned dispose function", () => {
    const registry = new CommandRegistry();
    const dispose = registry.register("test", { handler: () => {} });

    expect(registry.has("test")).toBe(true);
    dispose();
    expect(registry.has("test")).toBe(false);
  });

  it("should get a command by name", () => {
    const registry = new CommandRegistry();
    const handler = () => {};
    registry.register("greet", {
      description: "Say hi",
      handler,
    });

    const cmd = registry.get("greet");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("greet");
    expect(cmd!.description).toBe("Say hi");
    expect(cmd!.handler).toBe(handler);
  });

  it("should return undefined for unknown command", () => {
    const registry = new CommandRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("should execute a command", async () => {
    const registry = new CommandRegistry();
    let received: { args: string } | undefined;

    registry.register("echo", {
      handler: (args, ctx) => {
        received = { args: ctx.args };
      },
    });

    const result = await registry.execute("echo", "hello world");
    expect(result).toBe(true);
    expect(received).toEqual({ args: "hello world" });
  });

  it("should return false for executing unknown command", async () => {
    const registry = new CommandRegistry();
    const result = await registry.execute("nonexistent", "");
    expect(result).toBe(false);
  });

  it("should handle async command handlers", async () => {
    const registry = new CommandRegistry();
    let done = false;

    registry.register("slow", {
      handler: async () => {
        await new Promise((r) => setTimeout(r, 10));
        done = true;
      },
    });

    await registry.execute("slow", "");
    expect(done).toBe(true);
  });

  it("should list all commands sorted by name", () => {
    const registry = new CommandRegistry();
    registry.register("zebra", { description: "Z command", handler: () => {} });
    registry.register("alpha", { description: "A command", handler: () => {} });

    const list = registry.listCommands();
    expect(list).toHaveLength(3); // alpha, help, zebra
    expect(list[0].name).toBe("alpha");
    expect(list[0].source).toBe("extension");
    expect(list[1].name).toBe("help");
    expect(list[1].source).toBe("builtin");
    expect(list[2].name).toBe("zebra");
    expect(list[2].source).toBe("extension");
  });

  it("should get argument completions", () => {
    const registry = new CommandRegistry();
    registry.register("model", {
      getArgumentCompletions: (prefix) => {
        const models = ["gpt-4", "gpt-3.5", "claude-3"];
        const filtered = models.filter((m) => m.startsWith(prefix));
        return filtered.length > 0 ? filtered.map((m) => ({ value: m, label: m })) : null;
      },
      handler: () => {},
    });

    const completions = registry.getCompletions("model", "gpt");
    expect(completions).toHaveLength(2);
    expect(completions![0].value).toBe("gpt-4");
    expect(completions![1].value).toBe("gpt-3.5");
  });

  it("should return null for completions on command without completer", () => {
    const registry = new CommandRegistry();
    registry.register("simple", { handler: () => {} });
    expect(registry.getCompletions("simple", "")).toBeNull();
  });

  it("should return null for completions on unknown command", () => {
    const registry = new CommandRegistry();
    expect(registry.getCompletions("nonexistent", "")).toBeNull();
  });

  it("should handle command handler errors gracefully", async () => {
    const registry = new CommandRegistry();
    registry.register("boom", {
      handler: () => {
        throw new Error("handler exploded");
      },
    });

    // Should not throw, and should still return true (command was found)
    const result = await registry.execute("boom", "");
    expect(result).toBe(true);
  });

  it("should execute built-in help command", async () => {
    const registry = new CommandRegistry();
    registry.register("greet", {
      description: "Say hello",
      handler: () => {},
    });

    const result = await registry.execute("help", "");
    expect(result).toBe(true);
  });
});
