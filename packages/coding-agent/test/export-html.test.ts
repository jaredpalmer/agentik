import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AgentMessage, ToolInfo } from "@agentik/agent";
import { exportSessionToHtml } from "../src/session/export-html.js";
import { SessionStore } from "../src/session/store.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "agentik-export-html-"));
}

function makeAssistantMessage(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    model: "mock-model",
    usage: {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe("exportSessionToHtml", () => {
  it("should export a session file to HTML with metadata and tools", () => {
    const rootDir = makeTempDir();

    try {
      const store = new SessionStore({
        cwd: process.cwd(),
        provider: "anthropic",
        model: "claude-opus-4-6",
        rootDir,
      });

      store.appendMessage({
        role: "user",
        content: "Please read src/index.ts",
        timestamp: Date.now(),
      });
      store.appendMessage(makeAssistantMessage("Sure, I'll inspect that file."));

      const tools: ToolInfo[] = [
        {
          name: "read_file",
          description: "Read a file from disk",
          parameters: z.object({
            path: z.string(),
            offset: z.number().optional(),
          }),
        },
      ];

      const outputPath = join(rootDir, "session-export.html");
      const exportedPath = exportSessionToHtml(store.getSessionFile(), {
        outputPath,
        systemPrompt: "You are a coding assistant.",
        tools,
      });

      expect(exportedPath).toBe(outputPath);
      expect(existsSync(exportedPath)).toBe(true);

      const html = readFileSync(exportedPath, "utf8");
      expect(html).toContain("agentik session export");
      expect(html).toContain("You are a coding assistant.");
      expect(html).toContain("read_file");
      expect(html).toContain("path");
      expect(html).toContain("Please read src/index.ts");
      expect(html).toContain("Sure, I&#39;ll inspect that file.");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
