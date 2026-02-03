import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createEditTool } from "../src/tools/edit";
import { createReadTool } from "../src/tools/read";
import { createUpdateTool } from "../src/tools/update";
import { createWriteTool } from "../src/tools/write";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "openagent-files-"));
}

describe("file tools", () => {
  it("writes and reads files", async () => {
    const dir = createTempDir();
    try {
      const writer = createWriteTool(dir);
      const content = "hello world";
      const writeResult = await writer.execute?.({ path: "notes.txt", content });
      expect(writeResult?.output).toBe(`Wrote ${content.length} bytes to notes.txt.`);

      const reader = createReadTool(dir);
      const readResult = await reader.execute?.({ path: "notes.txt" });
      expect(readResult?.output).toBe(content);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports offsets and limits for reads", async () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, "lines.txt"), "one\ntwo\nthree\nfour");

      const reader = createReadTool(dir);
      const result = await reader.execute?.({ path: "lines.txt", offset: 2, limit: 1 });

      expect(result?.output).toContain("two");
      expect(result?.output).toContain("more lines");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when offset is beyond end of file", async () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, "lines.txt"), "one\ntwo");

      const reader = createReadTool(dir);
      let error: Error | undefined;
      try {
        await reader.execute?.({ path: "lines.txt", offset: 10 });
      } catch (err) {
        error = err as Error;
      }

      expect(error?.message).toContain("Offset");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("updates files only when content changes", async () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, "update.txt"), "alpha");

      const updater = createUpdateTool(dir);
      const noChange = await updater.execute?.({ path: "update.txt", content: "alpha" });
      expect(noChange?.output).toBe("No changes for update.txt.");

      const changed = await updater.execute?.({ path: "update.txt", content: "beta" });
      expect(changed?.output).toBe("Updated update.txt.");
      expect(readFileSync(join(dir, "update.txt"), "utf-8")).toBe("beta");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("edits files with exact matches", async () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, "edit.txt"), "hello world");

      const editor = createEditTool(dir);
      const result = await editor.execute?.({
        path: "edit.txt",
        oldText: "world",
        newText: "bun",
      });

      expect(result?.output).toBe("Updated edit.txt.");
      expect(readFileSync(join(dir, "edit.txt"), "utf-8")).toBe("hello bun");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when oldText is missing or ambiguous", async () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, "edit.txt"), "repeat repeat");

      const editor = createEditTool(dir);
      let missingError: Error | undefined;
      try {
        await editor.execute?.({ path: "edit.txt", oldText: "missing", newText: "x" });
      } catch (err) {
        missingError = err as Error;
      }

      let multipleError: Error | undefined;
      try {
        await editor.execute?.({ path: "edit.txt", oldText: "repeat", newText: "x" });
      } catch (err) {
        multipleError = err as Error;
      }

      expect(missingError?.message).toContain("oldText not found");
      expect(multipleError?.message).toContain("multiple times");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
