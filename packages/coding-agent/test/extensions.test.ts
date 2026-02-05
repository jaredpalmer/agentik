import { describe, expect, it } from "bun:test";
import { Agent, type ToolResultMessage } from "@agentik/agent";
import { z } from "zod";
import { bashGuard } from "../src/extensions/bash-guard.js";
import { toolLogger, type ToolLogEntry } from "../src/extensions/tool-logger.js";
import { contextInfo } from "../src/extensions/context-info.js";

// Minimal mock model
function createMockModel(
  responses: Array<{
    text?: string;
    toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  }>
) {
  let callIndex = 0;
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock-model",
    supportedUrls: {},
    doGenerate() {
      throw new Error("not implemented");
    },
    doStream() {
      const response = responses[callIndex++];
      if (!response) throw new Error("No more mock responses");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = [{ type: "stream-start", warnings: [] }];
      if (response.text) {
        const id = `text-${callIndex}`;
        parts.push({ type: "text-start", id });
        parts.push({ type: "text-delta", id, delta: response.text });
        parts.push({ type: "text-end", id });
      }
      if (response.toolCalls) {
        for (const tc of response.toolCalls) {
          const jsonStr = JSON.stringify(tc.args);
          parts.push({ type: "tool-input-start", id: tc.id, toolName: tc.name });
          parts.push({ type: "tool-input-delta", id: tc.id, delta: jsonStr });
          parts.push({ type: "tool-input-end", id: tc.id });
          parts.push({ type: "tool-call", toolCallId: tc.id, toolName: tc.name, input: jsonStr });
        }
      }
      const finishReason = response.toolCalls ? "tool-calls" : "stop";
      parts.push({
        type: "finish",
        finishReason,
        usage: {
          inputTokens: {
            total: 10,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 20, text: undefined, reasoning: undefined },
        },
      });
      const stream = new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      });
      return Promise.resolve({ stream });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const bashToolMock = {
  name: "bash",
  label: "Bash",
  description: "Execute a bash command",
  parameters: z.object({ command: z.string() }),
  execute: async (_id: string, params: { command: string }) => ({
    content: [{ type: "text" as const, text: `executed: ${params.command}` }],
    details: { exitCode: 0 },
  }),
};

describe("bashGuard extension", () => {
  it("should block rm -rf /", async () => {
    const model = createMockModel([
      { toolCalls: [{ id: "tc-1", name: "bash", args: { command: "rm -rf /" } }] },
      { text: "done" },
    ]);

    const agent = new Agent({ initialState: { model, tools: [bashToolMock] } });
    agent.use(bashGuard());
    await agent.prompt("delete everything");

    const results = agent.state.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult"
    );
    expect(results.length).toBeGreaterThan(0);
    const text = results[0].content[0].type === "text" ? results[0].content[0].text : "";
    expect(text).toContain("[bash-guard] Blocked");
  });

  it("should block rm -rf ~", async () => {
    const model = createMockModel([
      { toolCalls: [{ id: "tc-1", name: "bash", args: { command: "rm -rf ~" } }] },
      { text: "done" },
    ]);

    const agent = new Agent({ initialState: { model, tools: [bashToolMock] } });
    agent.use(bashGuard());
    await agent.prompt("delete home");

    const results = agent.state.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult"
    );
    const text = results[0].content[0].type === "text" ? results[0].content[0].text : "";
    expect(text).toContain("[bash-guard] Blocked");
  });

  it("should block git push --force to main", async () => {
    const model = createMockModel([
      {
        toolCalls: [
          { id: "tc-1", name: "bash", args: { command: "git push --force origin main" } },
        ],
      },
      { text: "done" },
    ]);

    const agent = new Agent({ initialState: { model, tools: [bashToolMock] } });
    agent.use(bashGuard());
    await agent.prompt("force push");

    const results = agent.state.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult"
    );
    const text = results[0].content[0].type === "text" ? results[0].content[0].text : "";
    expect(text).toContain("[bash-guard] Blocked");
  });

  it("should block fork bomb", async () => {
    const model = createMockModel([
      { toolCalls: [{ id: "tc-1", name: "bash", args: { command: ":(){ :|:& };:" } }] },
      { text: "done" },
    ]);

    const agent = new Agent({ initialState: { model, tools: [bashToolMock] } });
    agent.use(bashGuard());
    await agent.prompt("fork bomb");

    const results = agent.state.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult"
    );
    const text = results[0].content[0].type === "text" ? results[0].content[0].text : "";
    expect(text).toContain("[bash-guard] Blocked");
  });

  it("should allow safe commands through", async () => {
    let executed = false;
    const safeBash = {
      ...bashToolMock,
      execute: async (_id: string, params: { command: string }) => {
        executed = true;
        return {
          content: [{ type: "text" as const, text: `ok: ${params.command}` }],
          details: { exitCode: 0 },
        };
      },
    };

    const model = createMockModel([
      { toolCalls: [{ id: "tc-1", name: "bash", args: { command: "ls -la" } }] },
      { text: "done" },
    ]);

    const agent = new Agent({ initialState: { model, tools: [safeBash] } });
    agent.use(bashGuard());
    await agent.prompt("list files");

    expect(executed).toBe(true);
  });

  it("should not intercept non-bash tools", async () => {
    const echoTool = {
      name: "echo",
      label: "Echo",
      description: "Echo value",
      parameters: z.object({ value: z.string() }),
      execute: async (_id: string, params: { value: string }) => ({
        content: [{ type: "text" as const, text: params.value }],
        details: {},
      }),
    };

    const model = createMockModel([
      { toolCalls: [{ id: "tc-1", name: "echo", args: { value: "hello" } }] },
      { text: "done" },
    ]);

    const agent = new Agent({ initialState: { model, tools: [echoTool] } });
    agent.use(bashGuard());
    await agent.prompt("echo hello");

    const results = agent.state.messages.filter(
      (m): m is ToolResultMessage => m.role === "toolResult"
    );
    const text = results[0].content[0].type === "text" ? results[0].content[0].text : "";
    expect(text).toBe("hello");
  });
});

describe("toolLogger extension", () => {
  it("should capture tool execution events", async () => {
    const entries: ToolLogEntry[] = [];

    const model = createMockModel([
      { toolCalls: [{ id: "tc-1", name: "bash", args: { command: "echo hi" } }] },
      { text: "done" },
    ]);

    const agent = new Agent({ initialState: { model, tools: [bashToolMock] } });
    agent.use(toolLogger({ onLog: (entry) => entries.push(entry) }));
    await agent.prompt("run command");

    expect(entries.length).toBe(2);
    expect(entries[0].type).toBe("start");
    expect(entries[0].toolName).toBe("bash");
    expect(entries[1].type).toBe("end");
    expect(entries[1].toolName).toBe("bash");
    expect(entries[1].durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("contextInfo extension", () => {
  it("should inject context info message", async () => {
    const model = createMockModel([{ text: "response" }]);

    let transformedMessages: unknown[] = [];
    // Use a custom convertToLlm to capture what gets sent
    const origAgent = new Agent({
      initialState: { model },
      convertToLlm: (messages) => {
        transformedMessages = messages;
        return messages.filter(
          (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ) as any[];
      },
    });

    origAgent.use(contextInfo({ cwd: "/tmp/test" }));
    await origAgent.prompt("hello");

    // The first message in the transformed context should be the injected info
    expect(transformedMessages.length).toBeGreaterThanOrEqual(2);
    const first = transformedMessages[0] as { role: string; content: string };
    expect(first.role).toBe("user");
    expect(first.content).toContain("[context-info]");
    expect(first.content).toContain("/tmp/test");
  });
});
