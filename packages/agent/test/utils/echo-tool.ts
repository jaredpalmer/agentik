import { z } from "zod";
import type { AgentTool } from "../../src/types.js";

const echoToolSchema = z.object({ value: z.string() });

export const echoTool: AgentTool<z.infer<typeof echoToolSchema>, { echoed: string }> = {
  name: "echo",
  label: "Echo",
  description: "Echoes back the provided value",
  parameters: echoToolSchema,
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `echoed: ${params.value}` }],
      details: { echoed: params.value },
    };
  },
};
