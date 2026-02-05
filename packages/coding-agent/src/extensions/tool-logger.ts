import type { AgentEvent, Extension } from "@agentik/agent";

export interface ToolLoggerOptions {
  onLog?: (entry: ToolLogEntry) => void;
}

export interface ToolLogEntry {
  type: "start" | "end";
  toolName: string;
  toolCallId: string;
  args?: unknown;
  isError?: boolean;
  durationMs?: number;
}

export function toolLogger(opts?: ToolLoggerOptions): Extension {
  return (api) => {
    const startTimes = new Map<string, number>();
    const log =
      opts?.onLog ??
      ((entry: ToolLogEntry) => {
        if (entry.type === "start") {
          console.log(`[tool-logger] ${entry.toolName} started (${entry.toolCallId})`);
        } else {
          const status = entry.isError ? "error" : "ok";
          console.log(
            `[tool-logger] ${entry.toolName} ${status} in ${entry.durationMs}ms (${entry.toolCallId})`
          );
        }
      });

    api.on("event", (event: AgentEvent) => {
      if (event.type === "tool_execution_start") {
        startTimes.set(event.toolCallId, Date.now());
        log({
          type: "start",
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          args: event.args,
        });
      } else if (event.type === "tool_execution_end") {
        const startTime = startTimes.get(event.toolCallId);
        const durationMs = startTime ? Date.now() - startTime : 0;
        startTimes.delete(event.toolCallId);
        log({
          type: "end",
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          isError: event.isError,
          durationMs,
        });
      }
    });
  };
}
