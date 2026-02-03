import { describe, expect, it } from "bun:test";
import { formatSize, truncateHead, truncateTail } from "../src/tools/truncate";

describe("truncate", () => {
  describe("formatSize", () => {
    it("formats bytes and kilobytes", () => {
      expect(formatSize(5)).toBe("5B");
      expect(formatSize(1024)).toBe("1.0KB");
    });

    it("formats megabytes", () => {
      expect(formatSize(1024 * 1024)).toBe("1.0MB");
    });
  });

  describe("truncateHead", () => {
    it("returns content unchanged when under limits", () => {
      const result = truncateHead("a\nb\nc", { maxLines: 5, maxBytes: 100 });
      expect(result.truncated).toBe(false);
      expect(result.content).toBe("a\nb\nc");
    });

    it("truncates by lines", () => {
      const result = truncateHead("a\nb\nc", { maxLines: 2, maxBytes: 100 });
      expect(result.truncated).toBe(true);
      expect(result.truncatedBy).toBe("lines");
      expect(result.content).toBe("a\nb");
      expect(result.outputLines).toBe(2);
    });

    it("truncates by bytes", () => {
      const content = "hello world";
      const result = truncateHead(content, { maxLines: 10, maxBytes: 5 });
      expect(result.truncated).toBe(true);
      expect(result.truncatedBy).toBe("bytes");
      expect(result.content.length).toBeLessThan(content.length);
    });
  });

  describe("truncateTail", () => {
    it("returns content unchanged when under limits", () => {
      const result = truncateTail("a\nb\nc", { maxLines: 5, maxBytes: 100 });
      expect(result.truncated).toBe(false);
      expect(result.content).toBe("a\nb\nc");
    });

    it("truncates from the end by lines", () => {
      const result = truncateTail("a\nb\nc", { maxLines: 2, maxBytes: 100 });
      expect(result.truncated).toBe(true);
      expect(result.truncatedBy).toBe("lines");
      expect(result.content).toBe("b\nc");
    });

    it("truncates from the end by bytes", () => {
      const content = "hello world";
      const result = truncateTail(content, { maxLines: 10, maxBytes: 5 });
      expect(result.truncated).toBe(true);
      expect(result.truncatedBy).toBe("bytes");
      expect(result.content.length).toBeLessThan(content.length);
    });
  });
});
