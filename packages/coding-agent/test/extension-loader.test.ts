import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  discoverExtensions,
  loadExtensions,
  discoverAndLoadExtensions,
} from "../src/extensions/loader.js";

const tmpDirs: string[] = [];

function createTmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "agentik-ext-test-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe("discoverExtensions", () => {
  it("should discover .ts files in .agentik/extensions/", () => {
    const cwd = createTmpDir();
    const extDir = join(cwd, ".agentik", "extensions");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "my-ext.ts"), "export default () => {}");

    const paths = discoverExtensions(cwd);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toEndWith("my-ext.ts");
  });

  it("should discover index.ts in subdirectories", () => {
    const cwd = createTmpDir();
    const subDir = join(cwd, ".agentik", "extensions", "my-ext");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "index.ts"), "export default () => {}");

    const paths = discoverExtensions(cwd);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toEndWith("index.ts");
  });

  it("should return empty array when no extensions dir exists", () => {
    const cwd = createTmpDir();
    const paths = discoverExtensions(cwd);
    expect(paths).toHaveLength(0);
  });

  it("should deduplicate paths", () => {
    const cwd = createTmpDir();
    const extDir = join(cwd, ".agentik", "extensions");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "ext.ts"), "export default () => {}");

    const paths = discoverExtensions(cwd);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  it("should ignore non-ts/js files", () => {
    const cwd = createTmpDir();
    const extDir = join(cwd, ".agentik", "extensions");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "readme.md"), "# Readme");
    writeFileSync(join(extDir, "config.json"), "{}");
    writeFileSync(join(extDir, "ext.ts"), "export default () => {}");

    const paths = discoverExtensions(cwd);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toEndWith("ext.ts");
  });
});

describe("loadExtensions", () => {
  it("should load a valid extension", async () => {
    const dir = createTmpDir();
    const extPath = join(dir, "ext.ts");
    writeFileSync(extPath, "export default function() {}");

    const result = await loadExtensions([extPath]);
    expect(result.extensions).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(typeof result.extensions[0].factory).toBe("function");
  });

  it("should report error for non-existent file", async () => {
    const result = await loadExtensions(["/nonexistent/ext.ts"]);
    expect(result.extensions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("not found");
  });

  it("should report error for file without default export", async () => {
    const dir = createTmpDir();
    const extPath = join(dir, "bad-ext.ts");
    writeFileSync(extPath, "export const name = 'not a factory';");

    const result = await loadExtensions([extPath]);
    expect(result.extensions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("factory");
  });

  it("should isolate errors — one bad extension does not break others", async () => {
    const dir = createTmpDir();
    const goodPath = join(dir, "good.ts");
    const badPath = join(dir, "bad.ts");
    writeFileSync(goodPath, "export default function() {}");
    writeFileSync(badPath, "export const x = 1;");

    const result = await loadExtensions([goodPath, badPath]);
    expect(result.extensions).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.extensions[0].path).toBe(goodPath);
  });
});

describe("discoverExtensions — additional file types", () => {
  it("should discover .js files", () => {
    const cwd = createTmpDir();
    const extDir = join(cwd, ".agentik", "extensions");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "my-ext.js"), "export default () => {}");

    const paths = discoverExtensions(cwd);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toEndWith("my-ext.js");
  });

  it("should fall back to index.js when no index.ts", () => {
    const cwd = createTmpDir();
    const subDir = join(cwd, ".agentik", "extensions", "my-ext");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "index.js"), "export default () => {}");

    const paths = discoverExtensions(cwd);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toEndWith("index.js");
  });
});

describe("loadExtensions — import errors", () => {
  it("should report error for file that throws on import", async () => {
    const dir = createTmpDir();
    const extPath = join(dir, "throws.ts");
    writeFileSync(extPath, 'throw new Error("init error");');

    const result = await loadExtensions([extPath]);
    expect(result.extensions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("init error");
  });
});

describe("discoverAndLoadExtensions", () => {
  it("should discover and load extensions from project dir", async () => {
    const cwd = createTmpDir();
    const extDir = join(cwd, ".agentik", "extensions");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "ext.ts"), "export default function() {}");

    const result = await discoverAndLoadExtensions(cwd);
    expect(result.extensions).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it("should include extra paths", async () => {
    const cwd = createTmpDir();
    const extraDir = createTmpDir();
    const extPath = join(extraDir, "extra-ext.ts");
    writeFileSync(extPath, "export default function() {}");

    const result = await discoverAndLoadExtensions(cwd, [extPath]);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].path).toBe(resolve(extPath));
  });

  it("should return empty result when no extensions found", async () => {
    const cwd = createTmpDir();
    const result = await discoverAndLoadExtensions(cwd);
    expect(result.extensions).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
