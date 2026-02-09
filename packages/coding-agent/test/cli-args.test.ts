import { describe, expect, it } from "bun:test";
import { parseCliArgs } from "../src/cli/args.js";

describe("parseCliArgs", () => {
  it("should default all disable toggles to false", () => {
    const parsed = parseCliArgs([]);

    expect(parsed.disableExtensions).toBe(false);
    expect(parsed.disableSkills).toBe(false);
    expect(parsed.disablePromptTemplates).toBe(false);
    expect(parsed.passthroughArgs).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it("should parse long-form disable flags", () => {
    const parsed = parseCliArgs(["--no-extensions", "--no-skills", "--no-prompt-templates"]);

    expect(parsed.disableExtensions).toBe(true);
    expect(parsed.disableSkills).toBe(true);
    expect(parsed.disablePromptTemplates).toBe(true);
    expect(parsed.passthroughArgs).toEqual([]);
    expect(parsed.warnings).toEqual([
      "Ignoring --no-extensions/-ne: extension discovery is not configurable in this build yet.",
      "Ignoring --no-skills/-ns: skills are not configurable in this build yet.",
      "Ignoring --no-prompt-templates/-np: prompt templates are not configurable in this build yet.",
    ]);
  });

  it("should parse alias disable flags", () => {
    const parsed = parseCliArgs(["-ne", "-ns", "-np"]);

    expect(parsed.disableExtensions).toBe(true);
    expect(parsed.disableSkills).toBe(true);
    expect(parsed.disablePromptTemplates).toBe(true);
    expect(parsed.passthroughArgs).toEqual([]);
    expect(parsed.warnings).toEqual([
      "Ignoring --no-extensions/-ne: extension discovery is not configurable in this build yet.",
      "Ignoring --no-skills/-ns: skills are not configurable in this build yet.",
      "Ignoring --no-prompt-templates/-np: prompt templates are not configurable in this build yet.",
    ]);
  });

  it("should ignore unknown args safely", () => {
    const parsed = parseCliArgs(["--foo", "bar", "-x", "--no-extensions"]);

    expect(parsed.disableExtensions).toBe(true);
    expect(parsed.disableSkills).toBe(false);
    expect(parsed.disablePromptTemplates).toBe(false);
    expect(parsed.passthroughArgs).toEqual(["--foo", "bar", "-x"]);
    expect(parsed.warnings).toEqual([
      "Ignoring --no-extensions/-ne: extension discovery is not configurable in this build yet.",
    ]);
  });

  it("should not duplicate warnings when flags are repeated", () => {
    const parsed = parseCliArgs(["--no-skills", "-ns", "--no-prompt-templates", "-np"]);

    expect(parsed.disableSkills).toBe(true);
    expect(parsed.disablePromptTemplates).toBe(true);
    expect(parsed.warnings).toEqual([
      "Ignoring --no-skills/-ns: skills are not configurable in this build yet.",
      "Ignoring --no-prompt-templates/-np: prompt templates are not configurable in this build yet.",
    ]);
  });
});
