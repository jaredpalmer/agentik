import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initScaffold, loadRepoContext } from "../src/repo-scaffold";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0, dirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentik-coding-agent-"));
  dirs.push(dir);
  return dir;
}

describe("initScaffold", () => {
  it("creates the expected scaffold files", async () => {
    const cwd = await makeTempDir();
    await initScaffold({ cwd });

    const agentik = await readFile(join(cwd, "AGENTIK.md"), "utf8");
    const projectState = await readFile(join(cwd, "PROJECT_STATE.md"), "utf8");
    const safety = await readFile(join(cwd, ".agentik/rules/00-safety.md"), "utf8");
    const style = await readFile(join(cwd, ".agentik/rules/10-style.md"), "utf8");
    const settings = await readFile(join(cwd, ".agentik/settings.json"), "utf8");

    expect(agentik).toContain("Repo Operating Principles");
    expect(projectState).toContain("Current goal");
    expect(safety).toContain("Never access secrets");
    expect(style).toContain("Prefer minimal diffs");
    expect(settings).toContain('"rulesGlob": ".agentik/rules/**/*.md"');
  });

  it("respects --force semantics by not overwriting existing files unless requested", async () => {
    const cwd = await makeTempDir();
    await initScaffold({ cwd });

    const agentikFile = join(cwd, "AGENTIK.md");
    await writeFile(agentikFile, "custom", "utf8");

    await initScaffold({ cwd });
    expect(await readFile(agentikFile, "utf8")).toBe("custom");

    await initScaffold({ cwd, force: true });
    expect(await readFile(agentikFile, "utf8")).toContain("Repo Operating Principles");
  });
});

describe("loadRepoContext", () => {
  it("loads context in deterministic order", async () => {
    const cwd = await makeTempDir();
    await initScaffold({ cwd });
    await writeFile(join(cwd, ".agentik/rules/20-extra.md"), "# extra", "utf8");

    const context = await loadRepoContext({ cwd });
    expect(context.messages.map((message) => message.source)).toEqual([
      "AGENTIK.md",
      "PROJECT_STATE.md",
      ".agentik/rules/00-safety.md",
      ".agentik/rules/10-style.md",
      ".agentik/rules/20-extra.md",
    ]);
  });
});
