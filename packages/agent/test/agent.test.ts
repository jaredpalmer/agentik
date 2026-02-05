import { describe, expect, it } from "bun:test";
import { Agent } from "../src/agent.js";
import { createMockModel } from "./utils/mock-model.js";

describe("Agent", () => {
  it("should create an agent instance with default state", () => {
    const agent = new Agent();

    expect(agent.state).toBeDefined();
    expect(agent.state.systemPrompt).toBe("");
    expect(agent.state.thinkingLevel).toBe("off");
    expect(agent.state.tools).toEqual([]);
    expect(agent.state.messages).toEqual([]);
    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.streamMessage).toBe(null);
    expect(agent.state.pendingToolCalls).toEqual(new Set());
    expect(agent.state.error).toBeUndefined();
  });

  it("should create an agent instance with custom initial state", () => {
    const model = createMockModel([]);
    const agent = new Agent({
      initialState: {
        systemPrompt: "You are a helpful assistant.",
        model,
        thinkingLevel: "low",
      },
    });

    expect(agent.state.systemPrompt).toBe("You are a helpful assistant.");
    expect(agent.state.model).toBe(model);
    expect(agent.state.thinkingLevel).toBe("low");
  });

  it("should subscribe to events and unsubscribe", () => {
    const agent = new Agent();

    let eventCount = 0;
    const unsubscribe = agent.subscribe(() => {
      eventCount++;
    });

    // No initial event on subscribe
    expect(eventCount).toBe(0);

    // State mutators don't emit events
    agent.setSystemPrompt("Test prompt");
    expect(eventCount).toBe(0);
    expect(agent.state.systemPrompt).toBe("Test prompt");

    // Unsubscribe should work
    unsubscribe();
    agent.setSystemPrompt("Another prompt");
    expect(eventCount).toBe(0);
  });

  it("should update state with mutators", () => {
    const agent = new Agent();

    // setSystemPrompt
    agent.setSystemPrompt("Custom prompt");
    expect(agent.state.systemPrompt).toBe("Custom prompt");

    // setModel
    const newModel = createMockModel([]);
    agent.setModel(newModel);
    expect(agent.state.model).toBe(newModel);

    // setThinkingLevel
    agent.setThinkingLevel("high");
    expect(agent.state.thinkingLevel).toBe("high");

    // setTools
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = [{ name: "test", description: "test tool" } as any];
    agent.setTools(tools);
    expect(agent.state.tools).toBe(tools);

    // replaceMessages - should be a copy
    const messages = [{ role: "user" as const, content: "Hello", timestamp: Date.now() }];
    agent.replaceMessages(messages);
    expect(agent.state.messages).toEqual(messages);
    expect(agent.state.messages).not.toBe(messages);

    // appendMessage
    const newMessage = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Hi" }],
    } as unknown;
    agent.appendMessage(newMessage);
    expect(agent.state.messages).toHaveLength(2);
    expect(agent.state.messages[1]).toBe(newMessage);

    // clearMessages
    agent.clearMessages();
    expect(agent.state.messages).toEqual([]);
  });

  it("should support steering message queue", () => {
    const agent = new Agent();
    const message = { role: "user" as const, content: "Steering message", timestamp: Date.now() };
    agent.steer(message);

    // Queued but not in state.messages
    expect(agent.state.messages).not.toContainEqual(message);
  });

  it("should support follow-up message queue", () => {
    const agent = new Agent();
    const message = { role: "user" as const, content: "Follow-up message", timestamp: Date.now() };
    agent.followUp(message);

    // Queued but not in state.messages
    expect(agent.state.messages).not.toContainEqual(message);
  });

  it("should handle abort controller", () => {
    const agent = new Agent();
    // Should not throw even if nothing is running
    expect(() => agent.abort()).not.toThrow();
  });

  it("should support steering and follow-up mode settings", () => {
    const agent = new Agent();

    expect(agent.getSteeringMode()).toBe("one-at-a-time");
    expect(agent.getFollowUpMode()).toBe("one-at-a-time");

    agent.setSteeringMode("all");
    expect(agent.getSteeringMode()).toBe("all");

    agent.setFollowUpMode("all");
    expect(agent.getFollowUpMode()).toBe("all");
  });

  it("should reset state", () => {
    const agent = new Agent();
    agent.appendMessage({ role: "user", content: "Hello", timestamp: Date.now() });
    agent.steer({ role: "user", content: "Steer", timestamp: Date.now() });
    agent.followUp({ role: "user", content: "Follow", timestamp: Date.now() });

    agent.reset();

    expect(agent.state.messages).toEqual([]);
    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.streamMessage).toBe(null);
    expect(agent.state.pendingToolCalls).toEqual(new Set());
    expect(agent.state.error).toBeUndefined();
  });

  it("should throw when prompt() called while streaming", async () => {
    const model = createMockModel([{ text: "Hello" }, { text: "World" }]);
    const agent = new Agent({ initialState: { model } });

    // Start first prompt
    const firstPrompt = agent.prompt("First message");

    // Wait a tick for isStreaming to be set
    await new Promise((resolve) => setTimeout(resolve, 10));

    if (agent.state.isStreaming) {
      // Second prompt should reject
      try {
        await agent.prompt("Second message");
        expect(true).toBe(false); // should not reach
      } catch (e) {
        expect((e as Error).message).toContain("already processing");
      }
    }

    // Cleanup
    await firstPrompt.catch(() => {});
  });

  it("should handle a simple text prompt", async () => {
    const model = createMockModel([{ text: "Hi there!" }]);
    const agent = new Agent({ initialState: { model } });

    await agent.prompt("Hello");

    // Should have user + assistant messages
    expect(agent.state.messages.length).toBeGreaterThanOrEqual(2);
    expect(agent.state.messages[0].role).toBe("user");

    const lastMsg = agent.state.messages[agent.state.messages.length - 1];
    expect(lastMsg.role).toBe("assistant");
  });

  it("should waitForIdle() resolve after completion", async () => {
    const model = createMockModel([{ text: "Done" }]);
    const agent = new Agent({ initialState: { model } });

    void agent.prompt("Hello");
    await agent.waitForIdle();

    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.messages.length).toBeGreaterThan(0);
  });
});
