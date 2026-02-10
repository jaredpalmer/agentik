import type { AgentTool, AgentToolResult, TextContent } from "@agentik/agent";
import type { z } from "zod";

export interface RemoteToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: z.ZodType;
}

export interface PendingToolCall {
  resolve: (result: AgentToolResult<unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TOOL_TIMEOUT = 30_000;

export function createRemoteTool(
  definition: RemoteToolDefinition,
  sendRequest: (toolCallId: string, toolName: string, params: Record<string, unknown>) => void,
  pendingTools: Map<string, PendingToolCall>,
  toolTimeout = DEFAULT_TOOL_TIMEOUT
): AgentTool {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    async execute(toolCallId, params, signal?) {
      return new Promise<AgentToolResult<unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingTools.delete(toolCallId);
          reject(new Error(`Tool ${definition.name} timed out after ${toolTimeout}ms`));
        }, toolTimeout);

        pendingTools.set(toolCallId, { resolve, reject, timer });

        if (signal) {
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              pendingTools.delete(toolCallId);
              reject(new Error("Tool execution aborted"));
            },
            { once: true }
          );
        }

        sendRequest(toolCallId, definition.name, params as Record<string, unknown>);
      });
    },
  };
}

export function resolveToolCall(
  pendingTools: Map<string, PendingToolCall>,
  toolCallId: string,
  content: TextContent[],
  isError: boolean
): boolean {
  const pending = pendingTools.get(toolCallId);
  if (!pending) return false;

  clearTimeout(pending.timer);
  pendingTools.delete(toolCallId);

  pending.resolve({
    content,
    details: { isError },
  });
  return true;
}
