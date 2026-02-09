import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { ToolInfo } from "@agentik/agent";
import type { SessionEntry, SessionHeader } from "./store.js";

interface ToolParameterSchema {
  properties?: Record<string, unknown>;
  required?: string[];
}

interface ToolParameterRow {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
}

export interface ExportSessionOptions {
  outputPath?: string;
  systemPrompt?: string;
  tools?: ToolInfo[];
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseSessionEntries(sessionFile: string): SessionEntry[] {
  const text = readFileSync(sessionFile, "utf8");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const entries: SessionEntry[] = [];
  for (const line of lines) {
    entries.push(JSON.parse(line) as SessionEntry);
  }
  return entries;
}

function toToolParameterSchema(parameters: unknown): ToolParameterSchema | null {
  if (!parameters || typeof parameters !== "object") return null;

  const withToJsonSchema = parameters as { toJSONSchema?: () => unknown };
  if (typeof withToJsonSchema.toJSONSchema === "function") {
    try {
      const schema = withToJsonSchema.toJSONSchema();
      if (schema && typeof schema === "object") {
        return schema as ToolParameterSchema;
      }
    } catch {
      return null;
    }
  }

  return parameters as ToolParameterSchema;
}

function getParameterType(value: unknown): string {
  if (!value || typeof value !== "object") return "any";
  const v = value as { type?: unknown; anyOf?: unknown[]; oneOf?: unknown[] };

  if (typeof v.type === "string") return v.type;
  if (Array.isArray(v.type)) {
    const parts = v.type.filter((item): item is string => typeof item === "string");
    if (parts.length > 0) return parts.join("|");
  }

  const unionTypes = Array.isArray(v.anyOf) ? v.anyOf : Array.isArray(v.oneOf) ? v.oneOf : null;
  if (unionTypes) {
    const parts = unionTypes
      .map((option) => getParameterType(option))
      .filter((part) => part !== "any");
    if (parts.length > 0) return parts.join("|");
  }

  return "any";
}

function getParameterDescription(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { description?: unknown };
  if (typeof v.description !== "string") return null;
  const trimmed = v.description.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getToolParameterRows(parameters: unknown): ToolParameterRow[] {
  const schema = toToolParameterSchema(parameters);
  if (!schema?.properties || Object.keys(schema.properties).length === 0) {
    return [];
  }

  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties).map(([name, value]) => {
    return {
      name,
      type: getParameterType(value),
      required: required.has(name),
      description: getParameterDescription(value),
    };
  });
}

function formatToolParameters(parameters: unknown): string {
  const rows = getToolParameterRows(parameters);
  if (rows.length === 0) {
    return "(no parameters)";
  }

  const fields = rows.map((row) => {
    const optionalMark = row.required ? "" : "?";
    return `${row.name}${optionalMark}: ${row.type}`;
  });
  return `{ ${fields.join(", ")} }`;
}

function renderToolParameterDetails(parameters: unknown): string {
  const rows = getToolParameterRows(parameters);
  if (rows.length === 0) return "";

  const items = rows
    .map((row) => {
      const requiredClass = row.required ? "required" : "optional";
      const requiredText = row.required ? "required" : "optional";
      const descriptionHtml = row.description
        ? `<span class="tool-param-description">${escapeHtml(row.description)}</span>`
        : "";
      return `<li class="tool-param-item">
  <code>${escapeHtml(row.name)}</code>
  <span class="tool-param-type">${escapeHtml(row.type)}</span>
  <span class="tool-param-required ${requiredClass}">${escapeHtml(requiredText)}</span>
  ${descriptionHtml}
</li>`;
    })
    .join("\n");

  return `<details class="tool-param-details">
  <summary>input schema</summary>
  <ul class="tool-param-list">
${items}
  </ul>
</details>`;
}

function renderMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return `<pre>${escapeHtml(content)}</pre>`;
  }

  if (!Array.isArray(content)) {
    return `<pre>${escapeHtml(JSON.stringify(content, null, 2))}</pre>`;
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as {
      type?: unknown;
      text?: unknown;
      thinking?: unknown;
      name?: unknown;
      arguments?: unknown;
    };

    if (b.type === "text" && typeof b.text === "string") {
      parts.push(`<pre>${escapeHtml(b.text)}</pre>`);
      continue;
    }

    if (b.type === "thinking" && typeof b.thinking === "string") {
      parts.push(`<pre class="thinking">${escapeHtml(b.thinking)}</pre>`);
      continue;
    }

    if (b.type === "toolCall") {
      const toolName = typeof b.name === "string" ? b.name : "tool";
      const argsText = JSON.stringify(b.arguments ?? {}, null, 2);
      parts.push(
        `<details><summary>tool call: ${escapeHtml(toolName)}</summary><pre>${escapeHtml(argsText)}</pre></details>`
      );
      continue;
    }

    parts.push(`<pre>${escapeHtml(JSON.stringify(block, null, 2))}</pre>`);
  }

  return parts.join("\n");
}

function renderMessageEntry(entry: SessionEntry): string {
  if (entry.type !== "message") return "";
  const message = entry.message as {
    role?: unknown;
    content?: unknown;
    details?: unknown;
    toolName?: unknown;
    isError?: unknown;
  };
  const role = typeof message.role === "string" ? message.role : "unknown";
  const label =
    role === "toolResult" && typeof message.toolName === "string" ? message.toolName : role;
  const status =
    role === "toolResult" && typeof message.isError === "boolean"
      ? message.isError
        ? "error"
        : "ok"
      : "";

  let detailsHtml = "";
  if (role === "toolResult" && message.details !== undefined) {
    detailsHtml = `<details><summary>tool details</summary><pre>${escapeHtml(
      JSON.stringify(message.details, null, 2)
    )}</pre></details>`;
  }

  return `<article class="message role-${escapeHtml(role)}">
  <header>
    <span class="role">${escapeHtml(label)}</span>
    ${status ? `<span class="status status-${escapeHtml(status)}">${escapeHtml(status)}</span>` : ""}
    <span class="timestamp">${escapeHtml(entry.timestamp)}</span>
  </header>
  ${renderMessageContent(message.content)}
  ${detailsHtml}
</article>`;
}

function renderToolsSection(tools: ToolInfo[]): string {
  if (tools.length === 0) return "";

  const items = tools
    .map((tool) => {
      const paramText = formatToolParameters(tool.parameters);
      const paramDetails = renderToolParameterDetails(tool.parameters);
      return `<li><strong>${escapeHtml(tool.name)}</strong> - ${escapeHtml(tool.description)}<br /><code>${escapeHtml(
        paramText
      )}</code>${paramDetails}</li>`;
    })
    .join("\n");

  return `<section>
  <h2>Tools</h2>
  <ul>${items}</ul>
</section>`;
}

function renderHtml(
  header: SessionHeader,
  entries: SessionEntry[],
  options: ExportSessionOptions
): string {
  const messageHtml = entries.map(renderMessageEntry).join("\n");
  const tools = options.tools ?? [];
  const systemPromptHtml = options.systemPrompt
    ? `<section><h2>System Prompt</h2><pre>${escapeHtml(options.systemPrompt)}</pre></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>agentik session ${escapeHtml(header.id)}</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; margin: 0; background: #0b0f14; color: #dce3ea; }
    main { max-width: 980px; margin: 0 auto; padding: 24px; }
    h1, h2 { margin: 0 0 12px; }
    section { margin: 0 0 20px; padding: 12px; border: 1px solid #243242; border-radius: 8px; background: #101820; }
    .meta { color: #9db0c3; }
    .message { margin: 0 0 12px; padding: 10px; border: 1px solid #263646; border-radius: 8px; background: #0f1720; }
    .message header { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
    .role { font-weight: 700; color: #8dd0ff; }
    .timestamp { margin-left: auto; color: #8ca2b8; font-size: 12px; }
    .status { font-size: 12px; padding: 2px 6px; border-radius: 999px; }
    .status-ok { background: #15381f; color: #8ef0ad; }
    .status-error { background: #3c1b1f; color: #ff9fa8; }
    pre { margin: 0 0 8px; white-space: pre-wrap; word-break: break-word; }
    .thinking { color: #9db0c3; }
    code { color: #bde0ff; }
    details { margin: 6px 0; }
    .tool-param-details { margin-top: 8px; }
    .tool-param-list { margin: 8px 0 0; padding-left: 20px; }
    .tool-param-item { margin-bottom: 6px; }
    .tool-param-type { margin-left: 8px; color: #9db0c3; }
    .tool-param-required { margin-left: 8px; font-size: 12px; padding: 2px 6px; border-radius: 999px; }
    .tool-param-required.required { background: #15381f; color: #8ef0ad; }
    .tool-param-required.optional { background: #2a3340; color: #c7d2de; }
    .tool-param-description { display: block; margin-top: 4px; color: #9db0c3; }
    a { color: #8dd0ff; }
  </style>
</head>
<body>
  <main>
    <h1>agentik session export</h1>
    <section class="meta">
      <div><strong>Session:</strong> ${escapeHtml(header.id)}</div>
      <div><strong>Created:</strong> ${escapeHtml(header.createdAt)}</div>
      <div><strong>Provider/Model:</strong> ${escapeHtml(header.provider)}/${escapeHtml(header.model)}</div>
      <div><strong>CWD:</strong> ${escapeHtml(header.cwd)}</div>
    </section>
    ${systemPromptHtml}
    ${renderToolsSection(tools)}
    <section>
      <h2>Messages</h2>
      ${messageHtml}
    </section>
  </main>
</body>
</html>`;
}

export function exportSessionToHtml(
  sessionFile: string,
  options: ExportSessionOptions = {}
): string {
  const inputPath = resolve(sessionFile);
  const entries = parseSessionEntries(inputPath);
  const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
  if (!header) {
    throw new Error("Session header not found");
  }

  const html = renderHtml(
    header,
    entries.filter((entry) => entry.type === "message"),
    options
  );
  const defaultOutput = `${basename(inputPath, ".jsonl")}.html`;
  const outputPath = resolve(options.outputPath ?? defaultOutput);
  writeFileSync(outputPath, html, "utf8");
  return outputPath;
}
