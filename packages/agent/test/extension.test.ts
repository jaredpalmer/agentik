import { describe, expect, it } from "bun:test";
import { Agent } from "../src/agent.js";
import type { AgentEvent, AgentTool, Extension, ToolResultMessage } from "../src/types.js";
import { echoTool } from "./utils/echo-tool.js";
import { createMockModel } from "./utils/mock-model.js";

describe("Extension system", () => {
  it("should register and cleanup an extension", () => {
    const agent = new Agent();
    let cleaned = false;

    const ext: Extension = () => {
      return () => {
        cleaned = true;
      };
    };

    const dispose = agent.use(ext);
    expect(cleaned).toBe(false);

    dispose();
    expect(cleaned).toBe(true);
  });

  it("should register and unregister tools via extension API", () => {
    const agent = new Agent();
    expect(agent.state.tools).toHaveLength(0);

    const ext: Extension = (api) => {
      api.registerTool(echoTool);
    };

    const dispose = agent.use(ext);
    expect(agent.state.tools).toHaveLength(1);
    expect(agent.state.tools[0].name).toBe("echo");

    dispose();
    expect(agent.state.tools).toHaveLength(0);
  });

  it("should unregister tools via API method", () => {
    const agent = new Agent();

    const ext: Extension = (api) => {
      api.registerTool(echoTool);
      api.unregisterTool("echo");
    };

    agent.use(ext);
    expect(agent.state.tools).toHaveLength(0);
  });

  it("should provide read-only state access to extensions", () => {
    const agent = new Agent({
      initialState: { systemPrompt: "test prompt" },
    });

    let capturedPrompt = "";
    const ext: Extension = (api) => {
      capturedPrompt = api.state.systemPrompt;
    };

    agent.use(ext);
    expect(capturedPrompt).toBe("test prompt");
  });

  it("should chain transformContext hooks in order", async () => {
    const model = createMockModel([{ text: "response" }]);
    const agent = new Agent({ initialState: { model } });

    const order: number[] = [];

    const ext1: Extension = (api) => {
      api.on("transformContext", async (messages) => {
        order.push(1);
        return [
          ...messages,
          { role: "user" as const, content: "from ext1", timestamp: Date.now() },
        ];
      });
    };

    const ext2: Extension = (api) => {
      api.on("transformContext", async (messages) => {
        order.push(2);
        return [
          ...messages,
          { role: "user" as const, content: "from ext2", timestamp: Date.now() },
        ];
      });
    };

    agent.use(ext1);
    agent.use(ext2);

    await agent.prompt("hello");

    // Both hooks should have run in order
    expect(order).toEqual([1, 2]);
  });

  it("should run base transformContext before extension hooks", async () => {
    const model = createMockModel([{ text: "response" }]);
    const order: string[] = [];

    const agent = new Agent({
      initialState: { model },
      transformContext: async (messages) => {
        order.push("base");
        return messages;
      },
    });

    const ext: Extension = (api) => {
      api.on("transformContext", async (messages) => {
        order.push("ext");
        return messages;
      });
    };

    agent.use(ext);
    await agent.prompt("hello");

    expect(order).toEqual(["base", "ext"]);
  });

  it("should block tool calls via beforeToolCall hook", async () => {
    const model = createMockModel([
      {
        toolCalls: [{ id: "tc-1", name: "echo", args: { value: "hello" } }],
      },
      { text: "done" },
    ]);

    const agent = new Agent({
      initialState: { model, tools: [echoTool] },
    });

    let toolExecuted = false;
    const origExecute = echoTool.execute;
    const trackedTool: AgentTool = {
      ...echoTool,
      execute: async (...args) => {
        toolExecuted = true;
        return origExecute(...args);
      },
    };
    agent.setTools([trackedTool]);

    const ext: Extension = (api) => {
      api.on("beforeToolCall", async (toolCall) => {
        if (toolCall.name === "echo") {
          return {
            action: "block",
            result: {
              content: [{ type: "text", text: "blocked!" }],
              details: {},
            },
          };
        }
        return { action: "continue" };
      });
    };

    agent.use(ext);
    await agent.prompt("run echo");

    expect(toolExecuted).toBe(false);

    // Should have a tool result with "blocked!" text
    const toolResults = agent.state.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult"
    );
    expect(toolResults.length).toBeGreaterThan(0);
    expect(toolResults[0].content[0]).toEqual({ type: "text", text: "blocked!" });
  });

  it("should modify tool call args via beforeToolCall hook", async () => {
    let executedArgs: Record<string, unknown> | undefined;

    const tool: AgentTool = {
      ...echoTool,
      execute: async (_id, params) => {
        executedArgs = params as Record<string, unknown>;
        return {
          content: [{ type: "text", text: `echoed: ${(params as { value: string }).value}` }],
          details: {},
        };
      },
    };

    const model = createMockModel([
      {
        toolCalls: [{ id: "tc-1", name: "echo", args: { value: "original" } }],
      },
      { text: "done" },
    ]);

    const agent = new Agent({
      initialState: { model, tools: [tool] },
    });

    const ext: Extension = (api) => {
      api.on("beforeToolCall", async (toolCall) => {
        return {
          action: "continue",
          toolCall: { ...toolCall, arguments: { value: "modified" } },
        };
      });
    };

    agent.use(ext);
    await agent.prompt("run echo");

    expect(executedArgs).toEqual({ value: "modified" });
  });

  it("should modify tool result via afterToolResult hook", async () => {
    const model = createMockModel([
      {
        toolCalls: [{ id: "tc-1", name: "echo", args: { value: "hello" } }],
      },
      { text: "done" },
    ]);

    const agent = new Agent({
      initialState: { model, tools: [echoTool] },
    });

    const ext: Extension = (api) => {
      api.on("afterToolResult", async (_toolCall, result) => {
        return {
          ...result,
          content: [{ type: "text", text: "modified result" }],
        };
      });
    };

    agent.use(ext);
    await agent.prompt("run echo");

    const toolResults = agent.state.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult"
    );
    expect(toolResults.length).toBeGreaterThan(0);
    expect(toolResults[0].content[0]).toEqual({ type: "text", text: "modified result" });
  });

  it("should chain multiple beforeToolCall hooks — first block wins", async () => {
    const model = createMockModel([
      {
        toolCalls: [{ id: "tc-1", name: "echo", args: { value: "test" } }],
      },
      { text: "done" },
    ]);

    const agent = new Agent({
      initialState: { model, tools: [echoTool] },
    });

    const order: number[] = [];

    const ext1: Extension = (api) => {
      api.on("beforeToolCall", async () => {
        order.push(1);
        return {
          action: "block",
          result: {
            content: [{ type: "text", text: "blocked by ext1" }],
            details: {},
          },
        };
      });
    };

    const ext2: Extension = (api) => {
      api.on("beforeToolCall", async () => {
        order.push(2);
        return { action: "continue" };
      });
    };

    agent.use(ext1);
    agent.use(ext2);
    await agent.prompt("run echo");

    // Only first hook should run (it blocks)
    expect(order).toEqual([1]);

    const toolResults = agent.state.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult"
    );
    expect(toolResults[0].content[0]).toEqual({ type: "text", text: "blocked by ext1" });
  });

  it("should chain multiple afterToolResult hooks sequentially", async () => {
    const model = createMockModel([
      {
        toolCalls: [{ id: "tc-1", name: "echo", args: { value: "hello" } }],
      },
      { text: "done" },
    ]);

    const agent = new Agent({
      initialState: { model, tools: [echoTool] },
    });

    const ext1: Extension = (api) => {
      api.on("afterToolResult", async (_toolCall, result) => {
        const text = result.content[0].type === "text" ? result.content[0].text : "";
        return { ...result, content: [{ type: "text", text: text + " +ext1" }] };
      });
    };

    const ext2: Extension = (api) => {
      api.on("afterToolResult", async (_toolCall, result) => {
        const text = result.content[0].type === "text" ? result.content[0].text : "";
        return { ...result, content: [{ type: "text", text: text + " +ext2" }] };
      });
    };

    agent.use(ext1);
    agent.use(ext2);
    await agent.prompt("run echo");

    const toolResults = agent.state.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult"
    );
    const text = toolResults[0].content[0].type === "text" ? toolResults[0].content[0].text : "";
    expect(text).toContain("+ext1");
    expect(text).toContain("+ext2");
    // ext1 runs first, then ext2
    expect(text.indexOf("+ext1")).toBeLessThan(text.indexOf("+ext2"));
  });

  it("should subscribe to events via extension API", async () => {
    const model = createMockModel([{ text: "response" }]);
    const agent = new Agent({ initialState: { model } });

    const captured: AgentEvent[] = [];
    const ext: Extension = (api) => {
      api.on("event", (event) => {
        captured.push(event);
      });
    };

    agent.use(ext);
    await agent.prompt("hello");

    const types = captured.map((e) => e.type);
    expect(types).toContain("agent_start");
    expect(types).toContain("agent_end");
  });

  it("should cleanup all hooks when extension is disposed", async () => {
    const model = createMockModel([{ text: "r1" }, { text: "r2" }]);
    const agent = new Agent({ initialState: { model } });

    let hookCalled = false;
    const ext: Extension = (api) => {
      api.on("transformContext", async (messages) => {
        hookCalled = true;
        return messages;
      });
    };

    const dispose = agent.use(ext);

    await agent.prompt("first");
    expect(hookCalled).toBe(true);

    hookCalled = false;
    dispose();

    await agent.prompt("second");
    expect(hookCalled).toBe(false);
  });

  it("should allow extensions to steer and follow-up", () => {
    const agent = new Agent();

    const ext: Extension = (api) => {
      api.steer({ role: "user", content: "steer msg", timestamp: Date.now() });
      api.followUp({ role: "user", content: "followup msg", timestamp: Date.now() });
    };

    agent.use(ext);

    // Messages are queued internally, not in state.messages directly
    expect(agent.state.messages).toHaveLength(0);
  });

  it("should support registerTool and unregisterTool on Agent directly", () => {
    const agent = new Agent();

    const dispose = agent.registerTool(echoTool);
    expect(agent.state.tools).toHaveLength(1);

    dispose();
    expect(agent.state.tools).toHaveLength(0);
  });

  it("should return false from unregisterTool for unknown tool", () => {
    const agent = new Agent();
    expect(agent.unregisterTool("nonexistent")).toBe(false);
  });

  it("should handle multiple extensions interacting correctly", async () => {
    const model = createMockModel([
      {
        toolCalls: [{ id: "tc-1", name: "echo", args: { value: "test" } }],
      },
      { text: "done" },
    ]);

    const agent = new Agent({
      initialState: { model, tools: [echoTool] },
    });

    const events: string[] = [];

    // Extension 1: modify args
    const ext1: Extension = (api) => {
      api.on("beforeToolCall", async (toolCall) => {
        events.push("before1");
        return {
          action: "continue",
          toolCall: { ...toolCall, arguments: { value: "modified" } },
        };
      });
    };

    // Extension 2: log events
    const ext2: Extension = (api) => {
      api.on("event", (e) => {
        if (e.type === "tool_execution_start") events.push("event_start");
        if (e.type === "tool_execution_end") events.push("event_end");
      });
    };

    // Extension 3: modify result
    const ext3: Extension = (api) => {
      api.on("afterToolResult", async (_tc, result) => {
        events.push("after3");
        return result;
      });
    };

    agent.use(ext1);
    agent.use(ext2);
    agent.use(ext3);

    await agent.prompt("run echo");

    expect(events).toContain("before1");
    expect(events).toContain("event_start");
    expect(events).toContain("event_end");
    expect(events).toContain("after3");
  });
});
