import { jsonSchema } from "@ai-sdk/provider-utils";
import type { AgentToolDefinition } from "../types";
import { DEFAULT_MAX_BYTES, formatSize } from "./truncate";

export type WebFetchInput = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
};

const webFetchSchema = jsonSchema<WebFetchInput>({
  type: "object",
  properties: {
    url: { type: "string", description: "URL to fetch." },
    method: { type: "string", description: "HTTP method (default: GET)." },
    headers: { type: "object", description: "Request headers." },
    body: { type: "string", description: "Request body (string)." },
    timeoutMs: { type: "number", description: "Timeout in milliseconds." },
    maxBytes: { type: "number", description: "Maximum response bytes." },
  },
  required: ["url"],
  additionalProperties: false,
});

export function createWebFetchTool(): AgentToolDefinition<WebFetchInput, string> {
  return {
    name: "webfetch",
    label: "webfetch",
    description: `Fetch a URL and return the response body. Output is truncated to ${formatSize(DEFAULT_MAX_BYTES)}.`,
    inputSchema: webFetchSchema,
    execute: async (input) => {
      const controller = new AbortController();
      const timeoutMs = input.timeoutMs ?? 15000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(input.url, {
          method: input.method ?? "GET",
          headers: input.headers,
          body: input.body,
          signal: controller.signal,
        });

        const buffer = Buffer.from(await response.arrayBuffer());
        const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
        const truncated = buffer.length > maxBytes;
        const sliced = truncated ? buffer.subarray(0, maxBytes) : buffer;
        const contentType = response.headers.get("content-type") ?? "unknown";
        const text = sliced.toString("utf-8");

        let output = `Status: ${response.status} ${response.statusText}\nContent-Type: ${contentType}\n\n${text}`;
        if (truncated) {
          output += `\n\n[Output truncated at ${formatSize(maxBytes)}.]`;
        }
        return { output };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

export const webFetchTool = createWebFetchTool();
