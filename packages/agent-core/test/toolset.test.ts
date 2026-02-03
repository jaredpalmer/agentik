import { describe, expect, it } from "bun:test";
import type { AgentToolDefinition } from "../src/types";
import { createToolSet } from "../src/toolset";

function createAsyncGenerator(values: Array<{ output: string; ui?: string }>) {
  return (async function* () {
    for (const value of values) {
      yield value;
    }
  })();
}

describe("toolset", () => {
  it("emits start and end events", async () => {
    const events: string[] = [];
    let seenUi: unknown;

    const definition: AgentToolDefinition = {
      name: "demo",
      description: "demo",
      inputSchema: { type: "object" } as never,
      execute: async () => ({ output: "ok", ui: { view: "card" } }),
      toModelOutput: ({ ui }) => {
        seenUi = ui;
        return { type: "text", text: "ok" } as never;
      },
    };

    const toolSet = createToolSet([definition], {
      onStart: () => events.push("start"),
      onEnd: () => events.push("end"),
    });

    const tool = toolSet.demo as { execute?: Function; toModelOutput?: Function };
    await tool.execute?.({}, { toolCallId: "call-1", messages: [] });
    tool.toModelOutput?.({ toolCallId: "call-1", input: {}, output: "ok" });

    expect(events).toEqual(["start", "end"]);
    expect(seenUi).toEqual({ view: "card" });
  });

  it("streams partial results and emits updates", async () => {
    const updates: string[] = [];
    const definition: AgentToolDefinition = {
      name: "stream",
      inputSchema: { type: "object" } as never,
      execute: () =>
        createAsyncGenerator([
          { output: "step-1", ui: "u1" },
          { output: "step-2", ui: "u2" },
        ]),
    };

    const toolSet = createToolSet([definition], {
      onUpdate: ({ partialResult }) => updates.push(partialResult.output as string),
    });

    const tool = toolSet.stream as {
      execute: (
        input: unknown,
        options: { toolCallId: string; messages: [] }
      ) => AsyncIterable<string> | Promise<AsyncIterable<string>>;
    };
    const output: string[] = [];
    const result = await tool.execute({}, { toolCallId: "call-2", messages: [] });
    for await (const chunk of result) {
      output.push(chunk);
    }

    expect(updates).toEqual(["step-1", "step-2"]);
    expect(output).toEqual(["step-1", "step-2"]);
  });
});
