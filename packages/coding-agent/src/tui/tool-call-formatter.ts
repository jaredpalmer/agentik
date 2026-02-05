import { bold, dim, fg, stringToStyledText, t, StyledText, type TextChunk } from "@opentui/core";
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
const EXPLORATION_TOOLS = new Set(["read", "list", "glob"]);
const ACTION_VERBS = new Set(["Read", "List", "Search", "Run", "Fetch", "Write", "Edit", "Update"]);

export function formatToolContent(options: ToolCallFormatOptions): string {
  const lines: string[] = [];
  lines.push(formatToolHeaderLabel(options.toolName, options.status));
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

function formatToolHeaderLabel(toolName: string, status: ToolCallStatus): string {
  if (EXPLORATION_TOOLS.has(toolName)) {
    if (status === "running") {
      return "• Exploring";
    }
    if (status === "error") {
      return "• Exploration failed";
    }
    return "• Explored";
  }
  if (toolName === "bash") {
    if (status === "running") {
      return "• Running";
    }
    if (status === "error") {
      return "• Failed";
    }
    return "• Ran";
  }
  if (toolName === "webfetch") {
    if (status === "running") {
      return "• Fetching";
    }
    if (status === "error") {
      return "• Fetch failed";
    }
    return "• Fetched";
  }
  if (toolName === "write") {
    if (status === "running") {
      return "• Writing";
    }
    if (status === "error") {
      return "• Write failed";
    }
    return "• Wrote";
  }
  if (toolName === "edit") {
    if (status === "running") {
      return "• Editing";
    }
    if (status === "error") {
      return "• Edit failed";
    }
    return "• Edited";
  }
  if (toolName === "update") {
    if (status === "running") {
      return "• Updating";
    }
    if (status === "error") {
      return "• Update failed";
    }
    return "• Updated";
  }
  const label = formatToolName(toolName);
  if (status === "running") {
    return `• ${label}`;
  }
  if (status === "error") {
    return `• ${label} failed`;
  }
  return `• ${label}`;
}

function formatToolName(toolName: string): string {
  const normalized = toolName.replace(/[_-]+/g, " ");
  return normalized.length > 0
    ? `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)}`
    : toolName;
}

function formatToolHeader(header: string): StyledText {
  const match = header.match(/^•\s+(.+)$/);
  if (!match) {
    return t`${fg(colors.accent)(header)}`;
  }
  const title = match[1];
  const lowered = title.toLowerCase();
  const color = lowered.includes("failed") || lowered.includes("error") ? colors.error : undefined;
  const titleChunk = color ? fg(color)(bold(title)) : bold(title);
  return new StyledText([...t`${dim("•")} `.chunks, titleChunk]);
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
        const labelColor = label === "error" ? colors.error : colors.muted;
        const styled = t`${dim(TOOL_DETAIL_PREFIX)}${fg(labelColor)(label)}:${valueWithSpace}`;
        chunks.push(...styled.chunks);
      } else {
        const verbMatch = tail.match(/^([A-Za-z]+)\b(.*)$/);
        if (verbMatch && ACTION_VERBS.has(verbMatch[1])) {
          const [, verb, rest] = verbMatch;
          const styled = t`${dim(TOOL_DETAIL_PREFIX)}${fg(colors.accent)(verb)}${rest}`;
          chunks.push(...styled.chunks);
        } else {
          const styled = t`${dim(TOOL_DETAIL_PREFIX)}${tail}`;
          chunks.push(...styled.chunks);
        }
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
  const lines: string[] = [];
  if (!args || typeof args !== "object") {
    return lines;
  }
  const record = args as Record<string, unknown>;
  const push = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    lines.push(`${TOOL_DETAIL_PREFIX}${label}: ${formatValue(value)}`);
  };
  const pushAction = (verb: string, value: unknown) => {
    if (value === undefined || value === null || value === "") {
      lines.push(`${TOOL_DETAIL_PREFIX}${verb}`);
      return;
    }
    lines.push(`${TOOL_DETAIL_PREFIX}${verb} ${formatValue(value)}`);
  };

  switch (toolName) {
    case "read":
      pushAction("Read", record.path);
      break;
    case "list":
      pushAction("List", record.path ?? ".");
      break;
    case "glob":
      if (record.pattern && record.path) {
        lines.push(
          `${TOOL_DETAIL_PREFIX}Search ${formatValue(record.pattern)} in ${formatValue(record.path)}`
        );
      } else if (record.pattern) {
        pushAction("Search", record.pattern);
      } else {
        pushAction("Search", record.path ?? ".");
      }
      break;
    case "bash":
      pushAction("Run", record.command);
      break;
    case "webfetch":
      pushAction("Fetch", record.url);
      break;
    case "write":
      pushAction("Write", record.path);
      break;
    case "edit":
      pushAction("Edit", record.path);
      break;
    case "update":
      pushAction("Update", record.path);
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
  _args?: unknown
): string[] {
  if (status === "error") {
    if (output == null) {
      return [`${TOOL_DETAIL_PREFIX}error: unknown error`];
    }
    return [`${TOOL_DETAIL_PREFIX}error: ${formatValue(output)}`];
  }

  switch (toolName) {
    case "read": {
      return [];
    }
    case "list": {
      return [];
    }
    case "glob": {
      return [];
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
