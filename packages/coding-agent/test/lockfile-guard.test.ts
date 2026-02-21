import { describe, expect, it } from "bun:test";

describe("lockfile guard", () => {
  it("ensures no lockfiles are changed in the working diff", () => {
    const result = Bun.spawnSync([
      "bash",
      "-lc",
      "git diff --name-only | grep -E '(bun\\.lockb?|pnpm-lock\\.yaml|yarn\\.lock|package-lock\\.json)$' || true",
    ]);
    const output = Buffer.from(result.stdout).toString("utf8").trim();
    expect(output).toBe("");
  });
});
