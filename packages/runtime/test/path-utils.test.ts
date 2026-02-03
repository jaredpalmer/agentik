import { homedir } from "node:os";
import { describe, expect, it } from "bun:test";
import { expandPath, resolveToCwd } from "../src/tools/path-utils";

describe("path-utils", () => {
  describe("expandPath", () => {
    it("expands ~ to home directory", () => {
      expect(expandPath("~")).toBe(homedir());
    });

    it("expands ~/ to home directory path", () => {
      expect(expandPath("~/docs")).toBe(`${homedir()}/docs`);
    });

    it("leaves non-home paths unchanged", () => {
      expect(expandPath("relative/path")).toBe("relative/path");
    });
  });

  describe("resolveToCwd", () => {
    it("returns absolute paths as-is", () => {
      expect(resolveToCwd("/tmp/file.txt", "/cwd")).toBe("/tmp/file.txt");
    });

    it("resolves relative paths against cwd", () => {
      expect(resolveToCwd("file.txt", "/cwd")).toBe("/cwd/file.txt");
    });
  });
});
