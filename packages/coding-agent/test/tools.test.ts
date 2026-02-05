/* eslint-disable typescript-eslint/await-thenable -- bun:test expect().rejects returns a thenable */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { editTool } from "../src/tools/edit.js";
import { grepTool } from "../src/tools/grep.js";
import { lsTool } from "../src/tools/ls.js";
import { readFileTool } from "../src/tools/read-file.js";
import { writeFileTool } from "../src/tools/write-file.js";
import { globTool } from "../src/tools/glob.js";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `agentik-tools-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ============================================================================
// Edit Tool
// ============================================================================

describe("editTool", () => {
  test("replaces exact text in file", async () => {
    const filePath = join(TEST_DIR, "test.txt");
    writeFileSync(filePath, "hello world\nfoo bar\nbaz qux\n");

    const result = await editTool.execute("tc1", {
      path: filePath,
      oldText: "foo bar",
      newText: "foo BAR",
    });

    expect(result.content[0].text).toContain("Successfully replaced");
    expect(result.details?.diff).toBeDefined();

    // Verify file was changed
    const content = Bun.file(filePath).text();
    expect(await content).toBe("hello world\nfoo BAR\nbaz qux\n");
  });

  test("rejects when text not found", async () => {
    const filePath = join(TEST_DIR, "test.txt");
    writeFileSync(filePath, "hello world\n");

    await expect(
      editTool.execute("tc2", {
        path: filePath,
        oldText: "nonexistent text",
        newText: "replacement",
      })
    ).rejects.toThrow("Could not find the exact text");
  });

  test("rejects when multiple occurrences found", async () => {
    const filePath = join(TEST_DIR, "test.txt");
    writeFileSync(filePath, "hello\nhello\n");

    await expect(
      editTool.execute("tc3", {
        path: filePath,
        oldText: "hello",
        newText: "bye",
      })
    ).rejects.toThrow("occurrences");
  });

  test("handles fuzzy matching with smart quotes", async () => {
    const filePath = join(TEST_DIR, "test.txt");
    // File has smart quotes
    writeFileSync(filePath, "say \u201Chello\u201D to the world\n");

    // User provides ASCII quotes
    const result = await editTool.execute("tc4", {
      path: filePath,
      oldText: 'say "hello" to the world',
      newText: 'say "goodbye" to the world',
    });

    expect(result.content[0].text).toContain("Successfully replaced");
  });

  test("preserves BOM", async () => {
    const filePath = join(TEST_DIR, "bom.txt");
    writeFileSync(filePath, "\uFEFFhello world\n");

    await editTool.execute("tc5", {
      path: filePath,
      oldText: "hello world",
      newText: "hello universe",
    });

    // Read as buffer to check BOM (Bun.file().text() may strip BOM)
    const buf = readFileSync(filePath);
    // UTF-8 BOM is EF BB BF
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
    const content = buf.toString("utf-8");
    expect(content).toContain("hello universe");
  });

  test("preserves CRLF line endings", async () => {
    const filePath = join(TEST_DIR, "crlf.txt");
    writeFileSync(filePath, "line1\r\nline2\r\nline3\r\n");

    await editTool.execute("tc6", {
      path: filePath,
      oldText: "line2",
      newText: "LINE2",
    });

    const content = await Bun.file(filePath).text();
    expect(content).toContain("\r\n");
    expect(content).toContain("LINE2");
  });

  test("rejects file not found", async () => {
    await expect(
      editTool.execute("tc7", {
        path: join(TEST_DIR, "nonexistent.txt"),
        oldText: "foo",
        newText: "bar",
      })
    ).rejects.toThrow("File not found");
  });

  test("rejects when replacement produces identical content", async () => {
    const filePath = join(TEST_DIR, "test.txt");
    writeFileSync(filePath, "hello world\n");

    await expect(
      editTool.execute("tc8", {
        path: filePath,
        oldText: "hello world",
        newText: "hello world",
      })
    ).rejects.toThrow("No changes made");
  });

  test("returns diff with first changed line", async () => {
    const filePath = join(TEST_DIR, "test.txt");
    writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5\n");

    const result = await editTool.execute("tc9", {
      path: filePath,
      oldText: "line3",
      newText: "LINE_THREE",
    });

    expect(result.details?.firstChangedLine).toBeDefined();
    expect(result.details?.diff).toContain("-");
    expect(result.details?.diff).toContain("+");
  });
});

// ============================================================================
// Grep Tool
// ============================================================================

describe("grepTool", () => {
  test("finds matches in files", async () => {
    const subDir = join(TEST_DIR, "src");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "a.ts"), "const foo = 1;\nconst bar = 2;\n");
    writeFileSync(join(subDir, "b.ts"), "const baz = 3;\nconst foo = 4;\n");

    const result = await grepTool.execute("tc1", {
      pattern: "foo",
      path: subDir,
    });

    expect(result.content[0].text).toContain("foo");
    expect(result.content[0].text).toContain("a.ts");
    expect(result.content[0].text).toContain("b.ts");
  });

  test("returns no matches message", async () => {
    writeFileSync(join(TEST_DIR, "test.txt"), "hello world\n");

    const result = await grepTool.execute("tc2", {
      pattern: "nonexistent_pattern_xyz",
      path: TEST_DIR,
    });

    expect(result.content[0].text).toBe("No matches found");
  });

  test("respects glob filter", async () => {
    writeFileSync(join(TEST_DIR, "a.ts"), "const foo = 1;\n");
    writeFileSync(join(TEST_DIR, "b.js"), "const foo = 2;\n");

    const result = await grepTool.execute("tc3", {
      pattern: "foo",
      path: TEST_DIR,
      glob: "*.ts",
    });

    expect(result.content[0].text).toContain("a.ts");
    expect(result.content[0].text).not.toContain("b.js");
  });

  test("supports case-insensitive search", async () => {
    writeFileSync(join(TEST_DIR, "test.txt"), "Hello World\n");

    const result = await grepTool.execute("tc4", {
      pattern: "hello",
      path: TEST_DIR,
      ignoreCase: true,
    });

    expect(result.content[0].text).toContain("Hello World");
  });

  test("supports literal search", async () => {
    writeFileSync(join(TEST_DIR, "test.txt"), "foo.bar+baz\n");

    const result = await grepTool.execute("tc5", {
      pattern: "foo.bar+baz",
      path: TEST_DIR,
      literal: true,
    });

    expect(result.content[0].text).toContain("foo.bar+baz");
  });

  test("respects match limit", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `match line ${i}`).join("\n");
    writeFileSync(join(TEST_DIR, "test.txt"), lines);

    const result = await grepTool.execute("tc6", {
      pattern: "match",
      path: TEST_DIR,
      limit: 5,
    });

    expect(result.details?.matchLimitReached).toBe(5);
  });

  test("rejects nonexistent path", async () => {
    await expect(
      grepTool.execute("tc7", {
        pattern: "foo",
        path: join(TEST_DIR, "nonexistent"),
      })
    ).rejects.toThrow("Path not found");
  });
});

// ============================================================================
// LS Tool
// ============================================================================

describe("lsTool", () => {
  test("lists directory contents", async () => {
    writeFileSync(join(TEST_DIR, "file.txt"), "content");
    mkdirSync(join(TEST_DIR, "subdir"));
    writeFileSync(join(TEST_DIR, ".hidden"), "hidden");

    const result = await lsTool.execute("tc1", { path: TEST_DIR });

    expect(result.content[0].text).toContain("file.txt");
    expect(result.content[0].text).toContain("subdir/");
    expect(result.content[0].text).toContain(".hidden");
  });

  test("sorts alphabetically case-insensitive", async () => {
    writeFileSync(join(TEST_DIR, "Banana.txt"), "");
    writeFileSync(join(TEST_DIR, "apple.txt"), "");
    writeFileSync(join(TEST_DIR, "cherry.txt"), "");

    const result = await lsTool.execute("tc2", { path: TEST_DIR });
    const lines = result.content[0].text.split("\n");

    expect(lines[0]).toBe("apple.txt");
    expect(lines[1]).toBe("Banana.txt");
    expect(lines[2]).toBe("cherry.txt");
  });

  test("returns empty directory message", async () => {
    const emptyDir = join(TEST_DIR, "empty");
    mkdirSync(emptyDir);

    const result = await lsTool.execute("tc3", { path: emptyDir });
    expect(result.content[0].text).toBe("(empty directory)");
  });

  test("respects limit", async () => {
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(TEST_DIR, `file${i}.txt`), "");
    }

    const result = await lsTool.execute("tc4", { path: TEST_DIR, limit: 3 });
    expect(result.details?.entryLimitReached).toBe(3);
    expect(result.content[0].text).toContain("limit reached");
  });

  test("rejects nonexistent path", async () => {
    await expect(lsTool.execute("tc5", { path: join(TEST_DIR, "nonexistent") })).rejects.toThrow(
      "Path not found"
    );
  });

  test("rejects non-directory path", async () => {
    const filePath = join(TEST_DIR, "file.txt");
    writeFileSync(filePath, "content");

    await expect(lsTool.execute("tc6", { path: filePath })).rejects.toThrow("Not a directory");
  });
});

// ============================================================================
// Read File Tool
// ============================================================================

describe("readFileTool", () => {
  test("reads file with line numbers", async () => {
    const filePath = join(TEST_DIR, "test.txt");
    writeFileSync(filePath, "line1\nline2\nline3\n");

    const result = await readFileTool.execute("tc1", { path: filePath });
    expect(result.content[0].text).toContain("1");
    expect(result.content[0].text).toContain("line1");
  });

  test("supports offset and limit", async () => {
    const filePath = join(TEST_DIR, "test.txt");
    writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5\n");

    const result = await readFileTool.execute("tc2", {
      path: filePath,
      offset: 2,
      limit: 2,
    });

    expect(result.content[0].text).toContain("line2");
    expect(result.content[0].text).toContain("line3");
    expect(result.content[0].text).not.toContain("line1");
    expect(result.content[0].text).not.toContain("line4");
  });
});

// ============================================================================
// Write File Tool
// ============================================================================

describe("writeFileTool", () => {
  test("creates file and directories", async () => {
    const filePath = join(TEST_DIR, "sub", "dir", "test.txt");

    const result = await writeFileTool.execute("tc1", {
      path: filePath,
      content: "hello world",
    });

    expect(result.content[0].text).toContain("Wrote");
    expect(existsSync(filePath)).toBe(true);

    const content = await Bun.file(filePath).text();
    expect(content).toBe("hello world");
  });
});

// ============================================================================
// Glob Tool
// ============================================================================

describe("globTool", () => {
  test("finds files matching pattern", async () => {
    mkdirSync(join(TEST_DIR, "src"), { recursive: true });
    writeFileSync(join(TEST_DIR, "src", "a.ts"), "");
    writeFileSync(join(TEST_DIR, "src", "b.ts"), "");
    writeFileSync(join(TEST_DIR, "src", "c.js"), "");

    const result = await globTool.execute("tc1", {
      pattern: "**/*.ts",
      cwd: TEST_DIR,
    });

    expect(result.content[0].text).toContain("a.ts");
    expect(result.content[0].text).toContain("b.ts");
    expect(result.content[0].text).not.toContain("c.js");
    expect(result.details.count).toBe(2);
  });

  test("returns no files found", async () => {
    const result = await globTool.execute("tc2", {
      pattern: "**/*.xyz",
      cwd: TEST_DIR,
    });

    expect(result.content[0].text).toBe("No files found");
    expect(result.details.count).toBe(0);
  });
});
