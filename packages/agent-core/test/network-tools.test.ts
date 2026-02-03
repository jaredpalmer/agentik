import { afterAll, describe, expect, it } from "bun:test";
import { createBashTool } from "../src/tools/bash";
import { createWebFetchTool } from "../src/tools/webfetch";

const originalFetch = globalThis.fetch;

describe("network tools", () => {
  it("fetches and formats responses", async () => {
    globalThis.fetch = async () =>
      new Response("hello", {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/plain" },
      });

    const tool = createWebFetchTool();
    const result = await tool.execute?.({ url: "https://example.com" });

    expect(result?.output).toContain("Status: 200 OK");
    expect(result?.output).toContain("Content-Type: text/plain");
    expect(result?.output).toContain("hello");
  });

  it("truncates large responses", async () => {
    globalThis.fetch = async () =>
      new Response("x".repeat(20), {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/plain" },
      });

    const tool = createWebFetchTool();
    const result = await tool.execute?.({ url: "https://example.com", maxBytes: 5 });

    expect(result?.output).toContain("Output truncated");
  });

  it("runs a shell command and returns output", async () => {
    const tool = createBashTool(process.cwd());
    const result = await tool.execute?.({ command: "printf 'hello'" });

    expect(result?.output).toContain("Exit code: 0");
    expect(result?.output).toContain("hello");
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
