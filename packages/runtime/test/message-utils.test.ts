import { describe, expect, it } from "bun:test";
import { defaultConvertToModelMessages, isModelMessage } from "../src/message-utils";

const assistantMessage = { role: "assistant", content: "Hi" } as const;
const customMessage = { kind: "custom", content: "Custom" } as const;

describe("message-utils", () => {
  describe("isModelMessage", () => {
    it("returns false for non-objects", () => {
      expect(isModelMessage(null)).toBe(false);
      expect(isModelMessage(undefined)).toBe(false);
      expect(isModelMessage("hello")).toBe(false);
    });

    it("returns false for unknown roles", () => {
      expect(isModelMessage({ role: "unknown" })).toBe(false);
    });

    it("returns true for model message roles", () => {
      expect(isModelMessage({ role: "user", content: "Hi" })).toBe(true);
      expect(isModelMessage(assistantMessage)).toBe(true);
    });
  });

  describe("defaultConvertToModelMessages", () => {
    it("filters out custom messages", async () => {
      const result = await defaultConvertToModelMessages([
        customMessage,
        assistantMessage,
        { role: "user", content: "Hello" },
      ]);

      expect(result).toEqual([assistantMessage, { role: "user", content: "Hello" }]);
    });
  });
});
