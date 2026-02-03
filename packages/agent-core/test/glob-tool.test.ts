import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createGlobTool } from "../src/tools/glob";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "agentik-glob-"));
}

describe("glob tool", () => {
  it("returns sorted matches", async () => {
    const dir = createTempDir();
    try {
      const srcDir = join(dir, "src");
      mkdirSync(srcDir);
      writeFileSync(join(srcDir, "b.ts"), "b");
      writeFileSync(join(srcDir, "a.ts"), "a");

      const tool = createGlobTool(dir);
      const result = await tool.execute?.({ pattern: "*.ts", path: "src" });

      expect(result?.output).toBe("a.ts\nb.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns no files found message", async () => {
    const dir = createTempDir();
    try {
      const tool = createGlobTool(dir);
      const result = await tool.execute?.({ pattern: "*.md", path: "." });
      expect(result?.output).toBe("No files found.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds a limit hint when results are truncated", async () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, "a.ts"), "a");
      writeFileSync(join(dir, "b.ts"), "b");

      const tool = createGlobTool(dir);
      const result = await tool.execute?.({ pattern: "*.ts", limit: 1 });

      expect(result?.output).toContain("results limit reached");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
