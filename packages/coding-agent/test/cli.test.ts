import { describe, expect, it } from "bun:test";
import { runCli } from "../src/cli";

describe("runCli", () => {
  it("throws when OPENAGENT_MODEL is missing", async () => {
    const original = process.env.OPENAGENT_MODEL;
    delete process.env.OPENAGENT_MODEL;

    let error: Error | undefined;
    try {
      await runCli(["--print", "--prompt", "hello"]);
    } catch (err) {
      error = err as Error;
    } finally {
      if (original) {
        process.env.OPENAGENT_MODEL = original;
      } else {
        delete process.env.OPENAGENT_MODEL;
      }
    }

    expect(error?.message).toBe("OPENAGENT_MODEL is required.");
  });
});
