import { describe, expect, it } from "bun:test";
import { FlagRegistry } from "../src/extensions/flags.js";

describe("FlagRegistry", () => {
  it("should register a boolean flag with default", () => {
    const registry = new FlagRegistry();
    registry.register("verbose", {
      type: "boolean",
      default: false,
      description: "Enable verbose output",
    });

    expect(registry.has("verbose")).toBe(true);
    expect(registry.get("verbose")).toBe(false);
  });

  it("should register a string flag with default", () => {
    const registry = new FlagRegistry();
    registry.register("output", {
      type: "string",
      default: "json",
    });

    expect(registry.get("output")).toBe("json");
  });

  it("should return undefined for flag without default", () => {
    const registry = new FlagRegistry();
    registry.register("debug", { type: "boolean" });
    expect(registry.get("debug")).toBeUndefined();
  });

  it("should throw on duplicate registration", () => {
    const registry = new FlagRegistry();
    registry.register("verbose", { type: "boolean" });

    expect(() => {
      registry.register("verbose", { type: "boolean" });
    }).toThrow('Flag "--verbose" is already registered');
  });

  it("should unregister via returned dispose function", () => {
    const registry = new FlagRegistry();
    const dispose = registry.register("verbose", {
      type: "boolean",
      default: true,
    });

    expect(registry.has("verbose")).toBe(true);
    dispose();
    expect(registry.has("verbose")).toBe(false);
    expect(registry.get("verbose")).toBeUndefined();
  });

  it("should set a flag value", () => {
    const registry = new FlagRegistry();
    registry.register("verbose", { type: "boolean", default: false });
    registry.set("verbose", true);
    expect(registry.get("verbose")).toBe(true);
  });

  it("should list all flags sorted by name", () => {
    const registry = new FlagRegistry();
    registry.register("zebra", { type: "boolean" });
    registry.register("alpha", { type: "string", default: "a" });

    const list = registry.listFlags();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("alpha");
    expect(list[1].name).toBe("zebra");
  });

  it("should report size", () => {
    const registry = new FlagRegistry();
    expect(registry.size).toBe(0);
    registry.register("a", { type: "boolean" });
    registry.register("b", { type: "string" });
    expect(registry.size).toBe(2);
  });

  describe("applyCliArgs", () => {
    it("should apply boolean flag from CLI", () => {
      const registry = new FlagRegistry();
      registry.register("verbose", { type: "boolean", default: false });
      registry.applyCliArgs(["--verbose"]);
      expect(registry.get("verbose")).toBe(true);
    });

    it("should apply string flag with = from CLI", () => {
      const registry = new FlagRegistry();
      registry.register("output", { type: "string", default: "json" });
      registry.applyCliArgs(["--output=yaml"]);
      expect(registry.get("output")).toBe("yaml");
    });

    it("should apply boolean flag with =true from CLI", () => {
      const registry = new FlagRegistry();
      registry.register("verbose", { type: "boolean", default: false });
      registry.applyCliArgs(["--verbose=true"]);
      expect(registry.get("verbose")).toBe(true);
    });

    it("should apply boolean flag with =false from CLI", () => {
      const registry = new FlagRegistry();
      registry.register("verbose", { type: "boolean", default: true });
      registry.applyCliArgs(["--verbose=false"]);
      expect(registry.get("verbose")).toBe(false);
    });

    it("should ignore unknown flags", () => {
      const registry = new FlagRegistry();
      registry.register("known", { type: "boolean" });
      registry.applyCliArgs(["--unknown", "--known"]);
      expect(registry.get("known")).toBe(true);
      expect(registry.get("unknown")).toBeUndefined();
    });

    it("should ignore non-flag arguments", () => {
      const registry = new FlagRegistry();
      registry.register("verbose", { type: "boolean" });
      registry.applyCliArgs(["hello", "-v", "--verbose"]);
      expect(registry.get("verbose")).toBe(true);
    });
  });
});
