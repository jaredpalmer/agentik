import { describe, expect, it } from "bun:test";
import { agentLoop, agentLoopContinue } from "../src/agent-loop.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  Message,
  UserMessage,
} from "../src/types.js";
import { echoTool } from "./utils/echo-tool.js";
import { createMockModel } from "./utils/mock-model.js";

function createUserMessage(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function identityConverter(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"
  ) as Message[];
}

describe("agentLoop", () => {
  it("should emit standard event sequence for text response", async () => {
    const model = createMockModel([{ text: "Hi there!" }]);
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [],
      tools: [],
    };
    const config: AgentLoopConfig = {
      model,
      convertToLlm: identityConverter,
    };

    const events: AgentEvent[] = [];
    const stream = agentLoop([createUserMessage("Hello")], context, config);

    for await (const event of stream) {
      events.push(event);
    }

    const messages = await stream.result();

    // Should have user + assistant messages
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");

    // Verify event sequence
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("agent_start");
    expect(eventTypes).toContain("turn_start");
    expect(eventTypes).toContain("message_start");
    expect(eventTypes).toContain("message_end");
    expect(eventTypes).toContain("turn_end");
    expect(eventTypes).toContain("agent_end");
  });

  it("should handle custom message types via convertToLlm", async () => {
    interface CustomNotification {
      role: "notification";
      text: string;
      timestamp: number;
    }

    const notification: CustomNotification = {
      role: "notification",
      text: "This is a notification",
      timestamp: Date.now(),
    };

    const model = createMockModel([{ text: "Response" }]);
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [notification as unknown as AgentMessage],
      tools: [],
    };

    let convertedMessages: Message[] = [];
    const config: AgentLoopConfig = {
      model,
      convertToLlm: (messages) => {
        convertedMessages = messages
          .filter((m) => (m as { role: string }).role !== "notification")
          .filter(
            (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"
          ) as Message[];
        return convertedMessages;
      },
    };

    const stream = agentLoop([createUserMessage("Hello")], context, config);
    for await (const _ of stream) {
      // consume
    }

    // Notification should have been filtered out
    expect(convertedMessages.length).toBe(1);
    expect(convertedMessages[0].role).toBe("user");
  });

  it("should apply transformContext before convertToLlm", async () => {
    const model = createMockModel([{ text: "Response" }]);
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [
        createUserMessage("old 1"),
        createUserMessage("old 2"),
        createUserMessage("old 3"),
        createUserMessage("old 4"),
      ],
      tools: [],
    };

    let transformedMessages: AgentMessage[] = [];
    let convertedMessages: Message[] = [];

    const config: AgentLoopConfig = {
      model,
      transformContext: async (messages) => {
        // Keep only last 2 messages (prune old ones)
        transformedMessages = messages.slice(-2);
        return transformedMessages;
      },
      convertToLlm: (messages) => {
        convertedMessages = messages.filter(
          (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"
        ) as Message[];
        return convertedMessages;
      },
    };

    const stream = agentLoop([createUserMessage("new message")], context, config);
    for await (const _ of stream) {
      // consume
    }

    // transformContext prunes to last 2 messages
    expect(transformedMessages.length).toBe(2);
    // convertToLlm receives the pruned messages
    expect(convertedMessages.length).toBe(2);
  });

  it("should handle tool calls and results", async () => {
    const executed: string[] = [];
    const tool = {
      ...echoTool,
      async execute(_toolCallId: string, params: { value: string }) {
        executed.push(params.value);
        return {
          content: [{ type: "text" as const, text: `echoed: ${params.value}` }],
          details: { echoed: params.value },
        };
      },
    };

    const model = createMockModel([
      // First call: return tool call
      {
        toolCalls: [{ id: "tool-1", name: "echo", args: { value: "hello" } }],
      },
      // Second call: return final text
      { text: "done" },
    ]);

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    const config: AgentLoopConfig = {
      model,
      convertToLlm: identityConverter,
    };

    const events: AgentEvent[] = [];
    const stream = agentLoop([createUserMessage("echo something")], context, config);

    for await (const event of stream) {
      events.push(event);
    }

    // Tool should have been executed
    expect(executed).toEqual(["hello"]);

    // Should have tool execution events
    const toolStart = events.find((e) => e.type === "tool_execution_start");
    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolStart).toBeDefined();
    expect(toolEnd).toBeDefined();
    if (toolEnd?.type === "tool_execution_end") {
      expect(toolEnd.isError).toBe(false);
    }
  });

  it("should inject steering messages and skip remaining tool calls", async () => {
    const executed: string[] = [];
    const tool = {
      ...echoTool,
      async execute(_toolCallId: string, params: { value: string }) {
        executed.push(params.value);
        return {
          content: [{ type: "text" as const, text: `ok:${params.value}` }],
          details: { echoed: params.value },
        };
      },
    };

    const model = createMockModel([
      // First: two tool calls
      {
        toolCalls: [
          { id: "tool-1", name: "echo", args: { value: "first" } },
          { id: "tool-2", name: "echo", args: { value: "second" } },
        ],
      },
      // Second: final text
      { text: "done" },
    ]);

    const queuedUserMessage: AgentMessage = createUserMessage("interrupt");
    let queuedDelivered = false;

    const config: AgentLoopConfig = {
      model,
      convertToLlm: identityConverter,
      getSteeringMessages: async () => {
        // Deliver steering after first tool executes
        if (executed.length === 1 && !queuedDelivered) {
          queuedDelivered = true;
          return [queuedUserMessage];
        }
        return [];
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    const events: AgentEvent[] = [];
    const stream = agentLoop([createUserMessage("start")], context, config);

    for await (const event of stream) {
      events.push(event);
    }

    // Only first tool should have executed
    expect(executed).toEqual(["first"]);

    // Second tool should be skipped
    const toolEnds = events.filter(
      (e): e is Extract<AgentEvent, { type: "tool_execution_end" }> =>
        e.type === "tool_execution_end"
    );
    expect(toolEnds.length).toBe(2);
    expect(toolEnds[0].isError).toBe(false);
    expect(toolEnds[1].isError).toBe(true);

    // Steering message should appear in events
    const steeringEvent = events.find(
      (e) =>
        e.type === "message_start" &&
        e.message.role === "user" &&
        typeof e.message.content === "string" &&
        e.message.content === "interrupt"
    );
    expect(steeringEvent).toBeDefined();
  });

  it("should handle follow-up messages", async () => {
    const model = createMockModel([{ text: "First response" }, { text: "Follow-up response" }]);

    let followUpDelivered = false;
    const followUpMessage: AgentMessage = createUserMessage("follow up");

    const config: AgentLoopConfig = {
      model,
      convertToLlm: identityConverter,
      getFollowUpMessages: async () => {
        if (!followUpDelivered) {
          followUpDelivered = true;
          return [followUpMessage];
        }
        return [];
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
    };

    const events: AgentEvent[] = [];
    const stream = agentLoop([createUserMessage("Hello")], context, config);

    for await (const event of stream) {
      events.push(event);
    }

    const messages = await stream.result();

    // Should have: user, assistant, follow-up user, assistant
    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("user");
    expect(messages[3].role).toBe("assistant");
  });
});

describe("agentLoopContinue", () => {
  it("should throw when context has no messages", () => {
    const model = createMockModel([]);
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [],
      tools: [],
    };
    const config: AgentLoopConfig = {
      model,
      convertToLlm: identityConverter,
    };

    expect(() => agentLoopContinue(context, config)).toThrow(
      "Cannot continue: no messages in context"
    );
  });

  it("should throw when last message is assistant", () => {
    const model = createMockModel([]);
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "Hi" }],
          model: "mock",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      ],
      tools: [],
    };
    const config: AgentLoopConfig = {
      model,
      convertToLlm: identityConverter,
    };

    expect(() => agentLoopContinue(context, config)).toThrow(
      "Cannot continue from message role: assistant"
    );
  });

  it("should continue from existing context", async () => {
    const model = createMockModel([{ text: "Continued response" }]);
    const userMessage = createUserMessage("Hello");

    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [userMessage],
      tools: [],
    };

    const config: AgentLoopConfig = {
      model,
      convertToLlm: identityConverter,
    };

    const events: AgentEvent[] = [];
    const stream = agentLoopContinue(context, config);

    for await (const event of stream) {
      events.push(event);
    }

    const messages = await stream.result();

    // Should only return the new assistant message
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("assistant");

    // Should NOT have user message events
    const messageEndEvents = events.filter((e) => e.type === "message_end");
    expect(messageEndEvents.length).toBe(1);
    if (messageEndEvents[0].type === "message_end") {
      expect(messageEndEvents[0].message.role).toBe("assistant");
    }
  });
});
