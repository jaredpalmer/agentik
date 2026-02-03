import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createListTool } from "../src/tools/list";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "agentik-list-"));
}

describe("list tool", () => {
  it("lists and sorts entries", async () => {
    const dir = createTempDir();
    try {
      mkdirSync(join(dir, "folder"));
      writeFileSync(join(dir, "b.txt"), "b");
      writeFileSync(join(dir, "a.txt"), "a");

      const tool = createListTool(dir);
      const result = await tool.execute?.({ path: "." });

      const lines = result?.output.split("\n") ?? [];
      expect(lines).toEqual(["a.txt", "b.txt", "folder/"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty directory message", async () => {
    const dir = createTempDir();
    try {
      const tool = createListTool(dir);
      const result = await tool.execute?.({ path: "." });
      expect(result?.output).toBe("(empty directory)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds a limit hint when results are truncated", async () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, "a.txt"), "a");
      writeFileSync(join(dir, "b.txt"), "b");

      const tool = createListTool(dir);
      const result = await tool.execute?.({ path: ".", limit: 1 });

      expect(result?.output).toContain("entries limit reached");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
