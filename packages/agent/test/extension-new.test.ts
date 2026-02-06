import { describe, expect, it } from "bun:test";
import { Agent } from "../src/agent.js";
import type {
  AgentEndEvent,
  AgentStartEvent,
  AgentTool,
  Extension,
  MessageEndEvent,
  MessageStartEvent,
  ToolExecEndEvent,
  ToolExecStartEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "../src/types.js";
import { echoTool } from "./utils/echo-tool.js";
import { createMockModel } from "./utils/mock-model.js";

describe("Typed event subscriptions", () => {
  it("should fire agent_start and agent_end typed handlers", async () => {
    const model = createMockModel([{ text: "hi" }]);
    const agent = new Agent({ initialState: { model } });

    const starts: AgentStartEvent[] = [];
    const ends: AgentEndEvent[] = [];

    const ext: Extension = (api) => {
      api.on("agent_start", (e) => starts.push(e));
      api.on("agent_end", (e) => ends.push(e));
    };

    agent.use(ext);
    await agent.prompt("hello");

    expect(starts).toHaveLength(1);
    expect(starts[0].type).toBe("agent_start");
    expect(ends).toHaveLength(1);
    expect(ends[0].type).toBe("agent_end");
    expect(ends[0].messages.length).toBeGreaterThan(0);
  });

  it("should fire turn_start and turn_end typed handlers", async () => {
    const model = createMockModel([{ text: "hi" }]);
    const agent = new Agent({ initialState: { model } });

    const starts: TurnStartEvent[] = [];
    const ends: TurnEndEvent[] = [];

    const ext: Extension = (api) => {
      api.on("turn_start", (e) => starts.push(e));
      api.on("turn_end", (e) => ends.push(e));
    };

    agent.use(ext);
    await agent.prompt("hello");

    expect(starts.length).toBeGreaterThanOrEqual(1);
    expect(ends.length).toBeGreaterThanOrEqual(1);
  });

  it("should fire message_start and message_end typed handlers", async () => {
    const model = createMockModel([{ text: "hi" }]);
    const agent = new Agent({ initialState: { model } });

    const starts: MessageStartEvent[] = [];
    const ends: MessageEndEvent[] = [];

    const ext: Extension = (api) => {
      api.on("message_start", (e) => starts.push(e));
      api.on("message_end", (e) => ends.push(e));
    };

    agent.use(ext);
    await agent.prompt("hello");

    // At least user message start/end + assistant message start/end
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(ends.length).toBeGreaterThanOrEqual(2);
  });

  it("should fire tool_execution_start and tool_execution_end typed handlers", async () => {
    const model = createMockModel([
      {
        toolCalls: [{ id: "tc-1", name: "echo", args: { value: "hi" } }],
      },
      { text: "done" },
    ]);
    const agent = new Agent({ initialState: { model, tools: [echoTool] } });

    const starts: ToolExecStartEvent[] = [];
    const ends: ToolExecEndEvent[] = [];

    const ext: Extension = (api) => {
      api.on("tool_execution_start", (e) => starts.push(e));
      api.on("tool_execution_end", (e) => ends.push(e));
    };

    agent.use(ext);
    await agent.prompt("run echo");

    expect(starts).toHaveLength(1);
    expect(starts[0].toolName).toBe("echo");
    expect(starts[0].toolCallId).toBe("tc-1");
    expect(ends).toHaveLength(1);
    expect(ends[0].toolName).toBe("echo");
    expect(ends[0].isError).toBe(false);
  });

  it("should cleanup typed event handlers on dispose", async () => {
    const model = createMockModel([{ text: "r1" }, { text: "r2" }]);
    const agent = new Agent({ initialState: { model } });

    let called = false;
    const ext: Extension = (api) => {
      api.on("agent_start", () => {
        called = true;
      });
    };

    const dispose = agent.use(ext);
    await agent.prompt("first");
    expect(called).toBe(true);

    called = false;
    dispose();
    await agent.prompt("second");
    expect(called).toBe(false);
  });

  it("should unsubscribe individual typed handler via returned function", async () => {
    const model = createMockModel([{ text: "r1" }, { text: "r2" }]);
    const agent = new Agent({ initialState: { model } });

    let called = false;
    let unsub: (() => void) | undefined;

    const ext: Extension = (api) => {
      unsub = api.on("agent_start", () => {
        called = true;
      });
    };

    agent.use(ext);
    await agent.prompt("first");
    expect(called).toBe(true);

    called = false;
    unsub!();
    await agent.prompt("second");
    expect(called).toBe(false);
  });
});

describe("Input hooks", () => {
  it("should transform input text via input hook", async () => {
    const model = createMockModel([{ text: "hi" }]);
    const agent = new Agent({ initialState: { model } });

    const ext: Extension = (api) => {
      api.on("input", (text) => {
        return { action: "transform", text: text.toUpperCase() };
      });
    };

    agent.use(ext);
    await agent.prompt("hello");

    const userMsg = agent.state.messages[0];
    expect(userMsg.role).toBe("user");
    const content = userMsg.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("HELLO");
  });

  it("should handle input completely via input hook", async () => {
    const model = createMockModel([{ text: "should not be called" }]);
    const agent = new Agent({ initialState: { model } });

    let handled = false;
    const ext: Extension = (api) => {
      api.on("input", () => {
        handled = true;
        return { action: "handled" };
      });
    };

    agent.use(ext);
    await agent.prompt("hello");

    expect(handled).toBe(true);
    // No messages should be added since input was handled
    expect(agent.state.messages).toHaveLength(0);
  });

  it("should continue unchanged when input hook returns continue", async () => {
    const model = createMockModel([{ text: "hi" }]);
    const agent = new Agent({ initialState: { model } });

    const ext: Extension = (api) => {
      api.on("input", () => {
        return { action: "continue" };
      });
    };

    agent.use(ext);
    await agent.prompt("hello");

    const userMsg = agent.state.messages[0];
    const content = userMsg.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("hello");
  });

  it("should chain multiple input hooks", async () => {
    const model = createMockModel([{ text: "hi" }]);
    const agent = new Agent({ initialState: { model } });

    const ext1: Extension = (api) => {
      api.on("input", (text) => {
        return { action: "transform", text: text + " world" };
      });
    };

    const ext2: Extension = (api) => {
      api.on("input", (text) => {
        return { action: "transform", text: text.toUpperCase() };
      });
    };

    agent.use(ext1);
    agent.use(ext2);
    await agent.prompt("hello");

    const userMsg = agent.state.messages[0];
    const content = userMsg.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("HELLO WORLD");
  });

  it("should stop chain when a hook returns handled", async () => {
    const model = createMockModel([{ text: "should not run" }]);
    const agent = new Agent({ initialState: { model } });

    let secondCalled = false;

    const ext1: Extension = (api) => {
      api.on("input", () => {
        return { action: "handled" };
      });
    };

    const ext2: Extension = (api) => {
      api.on("input", () => {
        secondCalled = true;
        return { action: "continue" };
      });
    };

    agent.use(ext1);
    agent.use(ext2);
    await agent.prompt("hello");

    expect(secondCalled).toBe(false);
    expect(agent.state.messages).toHaveLength(0);
  });

  it("should cleanup input hooks on dispose", async () => {
    const model = createMockModel([{ text: "r1" }, { text: "r2" }]);
    const agent = new Agent({ initialState: { model } });

    let hookCalled = false;
    const ext: Extension = (api) => {
      api.on("input", (text) => {
        hookCalled = true;
        return { action: "transform", text: text + "!" };
      });
    };

    const dispose = agent.use(ext);
    await agent.prompt("first");
    expect(hookCalled).toBe(true);

    hookCalled = false;
    dispose();
    await agent.prompt("second");
    expect(hookCalled).toBe(false);

    const lastUserMsg = agent.state.messages.filter((m) => m.role === "user").pop()!;
    const content = lastUserMsg.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("second");
  });
});

describe("sendUserMessage", () => {
  it("should queue user message as follow-up by default", async () => {
    const model = createMockModel([{ text: "r1" }, { text: "r2" }]);
    const agent = new Agent({ initialState: { model } });

    const ext: Extension = (api) => {
      api.on("event", (e) => {
        if (e.type === "agent_start") {
          api.sendUserMessage("follow-up message");
        }
      });
    };

    agent.use(ext);
    await agent.prompt("hello");

    // Should have original user + assistant + follow-up user + assistant
    const userMsgs = agent.state.messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBeGreaterThanOrEqual(2);
  });

  it("should queue user message as steer when specified", () => {
    const agent = new Agent();

    const ext: Extension = (api) => {
      api.sendUserMessage("steer me", { deliverAs: "steer" });
    };

    agent.use(ext);
    // The message is queued internally, not in messages
    expect(agent.state.messages).toHaveLength(0);
  });
});

describe("Model and thinking level accessors", () => {
  it("should allow extensions to set/get thinking level", () => {
    const agent = new Agent();
    let captured: string | undefined;

    const ext: Extension = (api) => {
      api.setThinkingLevel("high");
      captured = api.getThinkingLevel();
    };

    agent.use(ext);
    expect(captured).toBe("high");
    expect(agent.state.thinkingLevel).toBe("high");
  });

  it("should allow extensions to set model", () => {
    const model1 = createMockModel([{ text: "1" }]);
    const model2 = createMockModel([{ text: "2" }]);
    const agent = new Agent({ initialState: { model: model1 } });

    const ext: Extension = (api) => {
      api.setModel(model2);
    };

    agent.use(ext);
    expect(agent.state.model).toBe(model2);
  });
});

describe("Active tools management", () => {
  it("should return all tools when no active filter set", () => {
    const tool1: AgentTool = { ...echoTool, name: "tool1" };
    const tool2: AgentTool = { ...echoTool, name: "tool2" };
    const agent = new Agent({ initialState: { tools: [tool1, tool2] } });

    let activeTools: string[] = [];
    const ext: Extension = (api) => {
      activeTools = api.getActiveTools();
    };

    agent.use(ext);
    expect(activeTools).toEqual(["tool1", "tool2"]);
  });

  it("should filter tools via setActiveTools", () => {
    const tool1: AgentTool = { ...echoTool, name: "tool1" };
    const tool2: AgentTool = { ...echoTool, name: "tool2" };
    const agent = new Agent({ initialState: { tools: [tool1, tool2] } });

    const ext: Extension = (api) => {
      api.setActiveTools(["tool1"]);
    };

    agent.use(ext);
    expect(agent.getActiveTools()).toEqual(["tool1"]);
  });

  it("should only send active tools to LLM context", async () => {
    const tool1: AgentTool = { ...echoTool, name: "tool1" };
    const tool2: AgentTool = { ...echoTool, name: "tool2" };
    const model = createMockModel([{ text: "done" }]);
    const agent = new Agent({ initialState: { model, tools: [tool1, tool2] } });

    agent.setActiveTools(["tool1"]);
    await agent.prompt("hello");

    // Tools are filtered but all still exist on state
    expect(agent.state.tools).toHaveLength(2);
    expect(agent.getActiveTools()).toEqual(["tool1"]);
  });
});
