import { describe, expect, it } from "bun:test";
import { runCli } from "../src/cli";

describe("runCli", () => {
  it("throws when AGENTIK_MODEL is missing", async () => {
    const original = process.env.AGENTIK_MODEL;
    delete process.env.AGENTIK_MODEL;

    let error: Error | undefined;
    try {
      await runCli(["--print", "--prompt", "hello"]);
    } catch (err) {
      error = err as Error;
    } finally {
      if (original) {
        process.env.AGENTIK_MODEL = original;
      } else {
        delete process.env.AGENTIK_MODEL;
      }
    }

    expect(error?.message).toBe("AGENTIK_MODEL is required.");
  });
});
