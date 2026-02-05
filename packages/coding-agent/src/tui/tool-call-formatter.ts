import { dim, fg, stringToStyledText, t, StyledText, type TextChunk } from "@opentui/core";
import { colors } from "./theme";

export type ToolCallStatus = "running" | "done" | "error";

export type ToolCallFormatOptions = {
  toolName: string;
  status: ToolCallStatus;
  args?: unknown;
  output?: unknown;
};

const TOOL_OUTPUT_MAX_LINES = 5;
const TOOL_DETAIL_PREFIX = "  └ ";
const TOOL_DETAIL_INDENT = "    ";

export function formatToolContent(options: ToolCallFormatOptions): string {
  const lines: string[] = [];
  const statusLabel = options.status === "error" ? "error" : options.status;
  const indicator = options.status === "running" ? "⠋" : "●";
  lines.push(`${indicator} ${options.toolName} (${statusLabel})`);
  lines.push(...summarizeToolArgs(options.toolName, options.args));
  lines.push(
    ...summarizeToolOutput(options.toolName, options.output, options.status, options.args)
  );
  return lines.join("\n");
}

export function formatToolStyledText(content: string): StyledText {
  const [header, ...rest] = content.split("\n");
  const headerStyled = formatToolHeader(header ?? "");
  const restStyled = formatToolBody(rest);
  const separator = rest.length > 0 ? stringToStyledText("\n") : null;
  return new StyledText([
    ...headerStyled.chunks,
    ...(separator ? separator.chunks : []),
    ...restStyled.chunks,
  ]);
}

function formatToolHeader(header: string): StyledText {
  const match = header.match(/^(\S)\s+(.+)\s+\((running|done|error)\)$/);
  if (!match) {
    return t`${fg(colors.accent)(header)}`;
  }
  const [, indicator, toolName, status] = match;
  const statusColor =
    status === "running" ? colors.accent : status === "error" ? colors.error : colors.success;
  return new StyledText([
    ...t`${fg(statusColor)(indicator)} `.chunks,
    ...t`${fg(colors.accent)(toolName)} `.chunks,
    ...t`${fg(colors.muted)(`(${status})`)}`.chunks,
  ]);
}

function formatToolBody(lines: string[]): StyledText {
  const chunks: TextChunk[] = [];
  lines.forEach((line, index) => {
    if (index > 0) {
      chunks.push(...stringToStyledText("\n").chunks);
    }
    if (line.startsWith(TOOL_DETAIL_PREFIX)) {
      const tail = line.slice(TOOL_DETAIL_PREFIX.length);
      const colonIndex = tail.indexOf(":");
      if (colonIndex > 0) {
        const label = tail.slice(0, colonIndex);
        const value = tail.slice(colonIndex + 1);
        const valueWithSpace = value.startsWith(" ") ? value : ` ${value}`;
        const styled = t`${dim(TOOL_DETAIL_PREFIX)}${fg(colors.muted)(label)}:${valueWithSpace}`;
        chunks.push(...styled.chunks);
      } else {
        const styled = t`${dim(TOOL_DETAIL_PREFIX)}${tail}`;
        chunks.push(...styled.chunks);
      }
      return;
    }

    if (line.startsWith(TOOL_DETAIL_INDENT)) {
      const rest = line.slice(TOOL_DETAIL_INDENT.length);
      const styled = t`${dim(TOOL_DETAIL_INDENT)}${rest}`;
      chunks.push(...styled.chunks);
      return;
    }

    chunks.push(...stringToStyledText(line).chunks);
  });
  return new StyledText(chunks);
}

function formatUnknown(
  value: unknown,
  options: { includeStack?: boolean; errorFallback?: string; nullFallback?: string } = {}
): string {
  if (value instanceof Error) {
    if (options.includeStack) {
      return value.stack ?? value.message ?? options.errorFallback ?? "Unknown error";
    }
    return value.message || options.errorFallback || "Error";
  }
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return options.nullFallback ?? String(value);
  }
  try {
    const json = JSON.stringify(value, null, 2);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

function formatValue(value: unknown): string {
  return formatUnknown(value, { errorFallback: "Error" });
}

function summarizeToolArgs(toolName: string, args: unknown): string[] {
  if (!args || typeof args !== "object") {
    return [];
  }
  const record = args as Record<string, unknown>;
  const lines: string[] = [];
  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    lines.push(`${TOOL_DETAIL_PREFIX}${label}: ${formatValue(value)}`);
  };

  switch (toolName) {
    case "read":
    case "write":
    case "edit":
    case "update":
      push("path", record.path);
      break;
    case "list":
      push("path", record.path ?? ".");
      if (record.limit != null) {
        push("limit", record.limit);
      }
      break;
    case "glob":
      push("pattern", record.pattern);
      push("path", record.path ?? ".");
      if (record.limit != null) {
        push("limit", record.limit);
      }
      break;
    case "bash":
      push("command", record.command);
      break;
    case "webfetch":
      push("url", record.url);
      if (record.method && record.method !== "GET") {
        push("method", record.method);
      }
      break;
    default:
      push("args", args);
      break;
  }

  return lines;
}

function summarizeToolOutput(
  toolName: string,
  output: unknown,
  status: ToolCallStatus,
  args?: unknown
): string[] {
  if (status === "error") {
    if (output == null) {
      return [`${TOOL_DETAIL_PREFIX}error: unknown error`];
    }
    return [`${TOOL_DETAIL_PREFIX}error: ${formatValue(output)}`];
  }

  switch (toolName) {
    case "read": {
      if (typeof output !== "string") {
        return output === undefined ? [] : [`  - result: ${formatValue(output)}`];
      }
      const { linesShown, rangeLabel } = summarizeReadOutput(output, args);
      const lines: string[] = [];
      if (rangeLabel) {
        lines.push(`${TOOL_DETAIL_PREFIX}range: ${rangeLabel}`);
      }
      lines.push(`${TOOL_DETAIL_PREFIX}result: ${linesShown} line${linesShown === 1 ? "" : "s"}`);
      return lines;
    }
    case "list": {
      if (typeof output !== "string") {
        return output === undefined ? [] : [`${TOOL_DETAIL_PREFIX}result: ${formatValue(output)}`];
      }
      const count = countPrimaryLines(output);
      return [`${TOOL_DETAIL_PREFIX}entries: ${count}`];
    }
    case "glob": {
      if (typeof output !== "string") {
        return output === undefined ? [] : [`${TOOL_DETAIL_PREFIX}result: ${formatValue(output)}`];
      }
      const count = countPrimaryLines(output);
      return [`${TOOL_DETAIL_PREFIX}matches: ${count}`];
    }
    case "webfetch": {
      if (typeof output !== "string") {
        return output === undefined ? [] : [`${TOOL_DETAIL_PREFIX}result: ${formatValue(output)}`];
      }
      const { statusLine, contentType } = extractWebFetchSummary(output);
      const lines: string[] = [];
      if (statusLine) {
        lines.push(`${TOOL_DETAIL_PREFIX}${statusLine}`);
      }
      if (contentType) {
        lines.push(`${TOOL_DETAIL_PREFIX}${contentType}`);
      }
      return lines;
    }
    case "bash": {
      if (output === undefined) {
        return [];
      }
      const text = formatValue(output);
      const { exitLine, body } = splitBashOutput(text);
      const lines: string[] = [];
      if (exitLine) {
        lines.push(`${TOOL_DETAIL_PREFIX}${exitLine}`);
      }
      if (body.trim().length > 0) {
        const { lines: outputLines, omitted } = limitLines(body, TOOL_OUTPUT_MAX_LINES);
        lines.push(`${TOOL_DETAIL_PREFIX}output:`);
        lines.push(...outputLines.map((line) => `${TOOL_DETAIL_INDENT}${line}`));
        if (omitted > 0) {
          lines.push(`${TOOL_DETAIL_INDENT}… +${omitted} lines`);
        }
      }
      return lines;
    }
    case "write":
    case "edit":
    case "update": {
      if (output === undefined) {
        return [];
      }
      return [`${TOOL_DETAIL_PREFIX}result: ${formatValue(output)}`];
    }
    default: {
      if (output === undefined) {
        return [];
      }
      if (typeof output !== "string") {
        return [`${TOOL_DETAIL_PREFIX}result: ${formatValue(output)}`];
      }
      const { lines: outputLines, omitted } = limitLines(output, TOOL_OUTPUT_MAX_LINES);
      const lines = [
        `${TOOL_DETAIL_PREFIX}output:`,
        ...outputLines.map((line) => `${TOOL_DETAIL_INDENT}${line}`),
      ];
      if (omitted > 0) {
        lines.push(`${TOOL_DETAIL_INDENT}… +${omitted} lines`);
      }
      return lines;
    }
  }
}

function summarizeReadOutput(
  output: string,
  args?: unknown
): { linesShown: number; rangeLabel?: string } {
  const { body } = splitOutputBody(output);
  const linesShown = body.length > 0 ? body.split("\n").length : 0;
  const rangeFromOutput = parseRangeFromReadOutput(output);
  if (rangeFromOutput) {
    return { linesShown, rangeLabel: rangeFromOutput };
  }

  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    const offset = typeof record.offset === "number" ? record.offset : undefined;
    if (offset !== undefined && linesShown > 0) {
      const end = offset + linesShown - 1;
      return { linesShown, rangeLabel: `${offset}-${end}` };
    }
  }

  return { linesShown };
}

function parseRangeFromReadOutput(output: string): string | undefined {
  const match = output.match(/Showing lines (\d+)-(\d+) of (\d+)/);
  if (!match) {
    return undefined;
  }
  return `${match[1]}-${match[2]} of ${match[3]}`;
}

function countPrimaryLines(output: string): number {
  const { body } = splitOutputBody(output);
  if (!body.trim()) {
    return 0;
  }
  return body.split("\n").filter((line) => line.trim().length > 0).length;
}

function splitOutputBody(output: string): { body: string; meta?: string } {
  const metaIndex = output.indexOf("\n\n[");
  if (metaIndex === -1) {
    return { body: output };
  }
  return { body: output.slice(0, metaIndex), meta: output.slice(metaIndex + 2) };
}

function extractWebFetchSummary(output: string): { statusLine?: string; contentType?: string } {
  const lines = output.split("\n");
  const statusLine = lines.find((line) => line.startsWith("Status:"));
  const contentType = lines.find((line) => line.startsWith("Content-Type:"));
  return { statusLine, contentType };
}

function splitBashOutput(output: string): { exitLine?: string; body: string } {
  const lines = output.split("\n");
  const first = lines[0];
  if (first && first.startsWith("Exit code:")) {
    return { exitLine: first, body: lines.slice(1).join("\n").trimStart() };
  }
  return { body: output };
}

function limitLines(text: string, maxLines: number): { lines: string[]; omitted: number } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return { lines, omitted: 0 };
  }
  return { lines: lines.slice(0, maxLines), omitted: lines.length - maxLines };
}
