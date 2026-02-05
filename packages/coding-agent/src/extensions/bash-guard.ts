import type { Extension } from "@agentik/agent";

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+[/~*]/, // rm -rf /, rm -rf ~, rm -rf *
  /\bgit\s+push\s+--force\b.*\b(main|master)\b/,
  /\bgit\s+push\b.*\b(main|master)\b.*--force\b/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb
];

export function bashGuard(): Extension {
  return (api) => {
    api.on("beforeToolCall", async (toolCall, _tool) => {
      if (toolCall.name !== "bash") {
        return { action: "continue" };
      }

      const command = String(toolCall.arguments.command ?? "");

      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
          return {
            action: "block",
            result: {
              content: [
                {
                  type: "text",
                  text: `[bash-guard] Blocked dangerous command: ${command}`,
                },
              ],
              details: { blocked: true, command, pattern: pattern.source },
            },
          };
        }
      }

      return { action: "continue" };
    });
  };
}
