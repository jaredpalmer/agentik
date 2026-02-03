import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  createCliRenderer,
  dim,
  fg,
  stringToStyledText,
  t,
  type TextChunk,
  type CliRenderer,
} from "@opentui/core";
import type { AgentEvent, AgentMessage, AgentRuntime } from "@openagent/agent-core";

type DisplayMessage = {
  role: string;
  content: string;
};

export type TuiAppOptions = {
  runtime: AgentRuntime;
};

export class TuiApp {
  private runtime: AgentRuntime;
  private renderer?: CliRenderer;
  private root?: BoxRenderable;
  private scrollBox?: ScrollBoxRenderable;
  private messagesView?: TextRenderable;
  private statusView?: TextRenderable;
  private input?: InputRenderable;
  private messages: DisplayMessage[] = [];
  private currentAssistantIndex?: number;
  private unsubscribe?: () => void;
  private isStreaming = false;
  private inputHeight = 1;
  private statusHeight = 1;
  private toolCallEntries = new Map<string, { index: number; toolName: string; args: unknown }>();
  private maxHistoryLines = 2000;

  constructor(options: TuiAppOptions) {
    this.runtime = options.runtime;
  }

  async start(): Promise<void> {
    if (this.renderer) {
      return;
    }
    this.renderer = await createCliRenderer({ exitOnCtrlC: true });
    this.root = new BoxRenderable(this.renderer, {
      id: "root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
    });
    this.scrollBox = new ScrollBoxRenderable(this.renderer, {
      id: "messages-scroll",
      flexGrow: 1,
      scrollY: true,
      scrollX: false,
      stickyScroll: true,
      stickyStart: "bottom",
      scrollbarOptions: {
        trackOptions: {
          foregroundColor: "#3b4252",
          backgroundColor: "#1f2328",
        },
      },
    });
    this.messagesView = new TextRenderable(this.renderer, {
      id: "messages",
      width: "100%",
      content: "",
    });
    this.statusView = new TextRenderable(this.renderer, {
      id: "status",
      width: "100%",
      height: this.statusHeight,
      content: "Ready",
    });
    this.input = new InputRenderable(this.renderer, {
      id: "input",
      width: "100%",
      placeholder: "Type a message and press Enter...",
      cursorColor: "#00FFFF",
      textColor: "#FFFFFF",
      placeholderColor: "#666666",
      backgroundColor: "transparent",
      maxLength: 4000,
    });
    this.scrollBox.add(this.messagesView);
    this.root.add(this.scrollBox);
    this.root.add(this.statusView);
    this.root.add(this.input);
    this.renderer.root.add(this.root);
    this.renderer.start();
    this.input.focus();
    this.input.on(InputRenderableEvents.ENTER, (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        if (this.input) {
          this.input.value = "";
        }
        return;
      }
      if (this.isStreaming) {
        this.setStatus("Busy. Wait for the current response to finish.");
        return;
      }
      this.isStreaming = true;
      this.setStatus("Thinking...");
      if (this.input) {
        this.input.value = "";
      }
      void this.runtime.prompt(trimmed).catch((error) => {
        this.isStreaming = false;
        this.setStatus(`Error: ${this.formatError(error)}`);
        this.render();
      });
    });
    this.renderer.on("resize", () => this.render());
    this.renderer.keyInput.on("keypress", (key) => {
      if (!this.scrollBox) {
        return;
      }
      const name = key.name;
      if (name !== "pageup" && name !== "pagedown" && name !== "home" && name !== "end") {
        return;
      }
      const handled = this.scrollBox.verticalScrollBar.handleKeyPress(key);
      if (handled) {
        key.preventDefault();
        key.stopPropagation();
        this.renderer?.requestRender();
      }
    });
    this.unsubscribe = this.runtime.subscribe((event) => this.handleEvent(event));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.renderer?.destroy();
    this.renderer = undefined;
    this.root = undefined;
    this.scrollBox = undefined;
    this.messagesView = undefined;
    this.statusView = undefined;
    this.input = undefined;
    this.messages = [];
    this.currentAssistantIndex = undefined;
    this.isStreaming = false;
    this.toolCallEntries.clear();
  }

  private handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start": {
        this.isStreaming = true;
        this.setStatus("Thinking...");
        break;
      }
      case "agent_end": {
        this.isStreaming = false;
        this.setStatus("Ready");
        break;
      }
      case "message_start": {
        if (this.isToolMessage(event.message)) {
          break;
        }
        const entry = this.formatMessage(event.message);
        this.messages.push(entry);
        if (entry.role === "assistant") {
          this.currentAssistantIndex = this.messages.length - 1;
        }
        this.render();
        break;
      }
      case "message_update": {
        if (this.currentAssistantIndex != null) {
          this.messages[this.currentAssistantIndex].content += event.delta;
          this.render();
        }
        break;
      }
      case "message_end": {
        if (this.isToolMessage(event.message)) {
          break;
        }
        if (this.messages.length > 0) {
          const entry = this.formatMessage(event.message);
          if (entry.role === "assistant" && entry.content.trim().length === 0) {
            this.messages.pop();
            this.currentAssistantIndex = undefined;
            this.render();
            break;
          }
          this.messages[this.messages.length - 1] = entry;
          if (entry.role === "assistant") {
            this.currentAssistantIndex = undefined;
          }
          this.render();
        }
        break;
      }
      case "tool_execution_start": {
        const content = this.formatToolContent({
          toolName: event.toolName,
          status: "running",
          args: event.args,
        });
        const index = this.messages.push({ role: "tool", content }) - 1;
        this.toolCallEntries.set(event.toolCallId, {
          index,
          toolName: event.toolName,
          args: event.args,
        });
        this.setStatus(`Tool: ${event.toolName}`);
        this.render();
        break;
      }
      case "tool_execution_update": {
        const existing = this.toolCallEntries.get(event.toolCallId);
        const index =
          existing?.index ??
          this.messages.push({
            role: "tool",
            content: this.formatToolContent({
              toolName: event.toolName,
              status: "running",
              args: existing?.args,
            }),
          }) - 1;
        const content = this.formatToolContent({
          toolName: event.toolName,
          status: "running",
          args: existing?.args,
          output: this.extractToolOutput(event.partialResult),
        });
        this.messages[index] = { role: "tool", content };
        if (!existing) {
          this.toolCallEntries.set(event.toolCallId, {
            index,
            toolName: event.toolName,
            args: undefined,
          });
        }
        this.render();
        break;
      }
      case "tool_execution_end": {
        const existing = this.toolCallEntries.get(event.toolCallId);
        const index =
          existing?.index ??
          this.messages.push({
            role: "tool",
            content: this.formatToolContent({
              toolName: event.toolName,
              status: event.isError ? "error" : "done",
              args: existing?.args,
            }),
          }) - 1;
        const content = this.formatToolContent({
          toolName: event.toolName,
          status: event.isError ? "error" : "done",
          args: existing?.args,
          output: this.extractToolOutput(event.result),
        });
        this.messages[index] = { role: "tool", content };
        this.toolCallEntries.delete(event.toolCallId);
        if (this.isStreaming) {
          this.setStatus("Thinking...");
        } else {
          this.setStatus("Ready");
        }
        this.render();
        break;
      }
      case "error": {
        this.isStreaming = false;
        const message = this.formatError(event.error);
        this.messages.push({ role: "error", content: message });
        this.setStatus(`Error: ${message}`);
        this.render();
        break;
      }
      default:
        break;
    }
  }

  private formatMessage(message: AgentMessage): DisplayMessage {
    const role = this.extractRole(message);
    const content = this.extractContent(message);
    return { role, content };
  }

  private isToolMessage(message: AgentMessage): boolean {
    if (message && typeof message === "object" && "role" in message) {
      const role = (message as { role?: string }).role;
      return role === "tool" || role === "tool_result" || role === "toolResult";
    }
    return false;
  }

  private extractRole(message: AgentMessage): string {
    if (message && typeof message === "object" && "role" in message) {
      const role = (message as { role?: string }).role;
      if (role) {
        return role;
      }
    }
    return "custom";
  }

  private extractContent(message: AgentMessage): string {
    if (message && typeof message === "object" && "content" in message) {
      const content = (message as { content?: unknown }).content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        const textParts = content
          .filter((part) => part && typeof part === "object" && "text" in part)
          .map((part) => (part as { text?: unknown }).text)
          .filter((text): text is string => typeof text === "string");
        if (textParts.length > 0) {
          return textParts.join("");
        }
        return "";
      }
      return JSON.stringify(content, null, 2);
    }
    return JSON.stringify(message, null, 2);
  }

  private formatToolContent(options: {
    toolName: string;
    status: "running" | "done" | "error";
    args?: unknown;
    output?: unknown;
  }): string {
    const lines: string[] = [];
    const statusLabel = options.status === "error" ? "error" : options.status;
    lines.push(`${options.toolName} (${statusLabel})`);
    lines.push(...this.summarizeToolArgs(options.toolName, options.args));
    lines.push(
      ...this.summarizeToolOutput(options.toolName, options.output, options.status, options.args)
    );
    return lines.join("\n");
  }

  private extractToolOutput(value: unknown): unknown {
    if (value && typeof value === "object" && "output" in value) {
      return (value as { output?: unknown }).output;
    }
    return value;
  }

  private formatValue(value: unknown): string {
    if (value instanceof Error) {
      return value.message || "Error";
    }
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private summarizeToolArgs(toolName: string, args: unknown): string[] {
    if (!args || typeof args !== "object") {
      return [];
    }
    const record = args as Record<string, unknown>;
    const lines: string[] = [];
    const push = (label: string, value: unknown) => {
      if (value === undefined || value === null || value === "") {
        return;
      }
      lines.push(`  - ${label}: ${this.formatValue(value)}`);
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

  private summarizeToolOutput(
    toolName: string,
    output: unknown,
    status: "running" | "done" | "error",
    args?: unknown
  ): string[] {
    if (status === "error") {
      if (output == null) {
        return ["  - error: unknown error"];
      }
      return [`  - error: ${this.formatValue(output)}`];
    }

    switch (toolName) {
      case "read": {
        if (typeof output !== "string") {
          return output === undefined ? [] : [`  - result: ${this.formatValue(output)}`];
        }
        const { linesShown, rangeLabel } = this.summarizeReadOutput(output, args);
        const lines: string[] = [];
        if (rangeLabel) {
          lines.push(`  - range: ${rangeLabel}`);
        }
        lines.push(`  - result: ${linesShown} line${linesShown === 1 ? "" : "s"}`);
        return lines;
      }
      case "list": {
        if (typeof output !== "string") {
          return output === undefined ? [] : [`  - result: ${this.formatValue(output)}`];
        }
        const count = this.countPrimaryLines(output);
        return [`  - entries: ${count}`];
      }
      case "glob": {
        if (typeof output !== "string") {
          return output === undefined ? [] : [`  - result: ${this.formatValue(output)}`];
        }
        const count = this.countPrimaryLines(output);
        return [`  - matches: ${count}`];
      }
      case "webfetch": {
        if (typeof output !== "string") {
          return output === undefined ? [] : [`  - result: ${this.formatValue(output)}`];
        }
        const { statusLine, contentType } = this.extractWebFetchSummary(output);
        const lines: string[] = [];
        if (statusLine) {
          lines.push(`  - ${statusLine}`);
        }
        if (contentType) {
          lines.push(`  - ${contentType}`);
        }
        return lines;
      }
      case "bash": {
        if (output === undefined) {
          return [];
        }
        const text = this.formatValue(output);
        const { exitLine, body } = this.splitBashOutput(text);
        const lines: string[] = [];
        if (exitLine) {
          lines.push(`  - ${exitLine}`);
        }
        if (body.trim().length > 0) {
          lines.push("  - output:");
          lines.push(...this.indentLines(body, "    "));
        }
        return lines;
      }
      case "write":
      case "edit":
      case "update": {
        if (output === undefined) {
          return [];
        }
        return [`  - result: ${this.formatValue(output)}`];
      }
      default: {
        if (output === undefined) {
          return [];
        }
        return [`  - result: ${this.formatValue(output)}`];
      }
    }
  }

  private summarizeReadOutput(
    output: string,
    args?: unknown
  ): { linesShown: number; rangeLabel?: string } {
    const { body } = this.splitOutputBody(output);
    const linesShown = body.length > 0 ? body.split("\n").length : 0;
    const rangeFromOutput = this.parseRangeFromReadOutput(output);
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

  private parseRangeFromReadOutput(output: string): string | undefined {
    const match = output.match(/Showing lines (\d+)-(\d+) of (\d+)/);
    if (!match) {
      return undefined;
    }
    return `${match[1]}-${match[2]} of ${match[3]}`;
  }

  private countPrimaryLines(output: string): number {
    const { body } = this.splitOutputBody(output);
    if (!body.trim()) {
      return 0;
    }
    return body.split("\n").filter((line) => line.trim().length > 0).length;
  }

  private splitOutputBody(output: string): { body: string; meta?: string } {
    const metaIndex = output.indexOf("\n\n[");
    if (metaIndex === -1) {
      return { body: output };
    }
    return { body: output.slice(0, metaIndex), meta: output.slice(metaIndex + 2) };
  }

  private extractWebFetchSummary(output: string): { statusLine?: string; contentType?: string } {
    const lines = output.split("\n");
    const statusLine = lines.find((line) => line.startsWith("Status:"));
    const contentType = lines.find((line) => line.startsWith("Content-Type:"));
    return { statusLine, contentType };
  }

  private splitBashOutput(output: string): { exitLine?: string; body: string } {
    const lines = output.split("\n");
    const first = lines[0];
    if (first && first.startsWith("Exit code:")) {
      return { exitLine: first, body: lines.slice(1).join("\n").trimStart() };
    }
    return { body: output };
  }

  private indentLines(text: string, indent: string): string[] {
    if (!text) {
      return [];
    }
    return text.split("\n").map((line) => `${indent}${line}`);
  }

  private formatDisplayMessage(message: DisplayMessage): StyledText {
    const role = message.role || "custom";
    const roleLabel = this.formatRoleLabel(role);

    if (role === "tool") {
      const [header, ...rest] = message.content.split("\n");
      const headerStyled = t`${fg("#7aa2b8")(header)}`;
      const restStyled = this.formatToolBody(rest);
      const separator = rest.length > 0 ? stringToStyledText("\n") : null;
      return new StyledText([
        ...roleLabel.chunks,
        ...headerStyled.chunks,
        ...(separator ? separator.chunks : []),
        ...restStyled.chunks,
      ]);
    }

    if (role === "error") {
      const contentStyled = t`${fg("#cc6666")(message.content)}`;
      return new StyledText([...roleLabel.chunks, ...contentStyled.chunks]);
    }

    const contentStyled = stringToStyledText(message.content);
    return new StyledText([...roleLabel.chunks, ...contentStyled.chunks]);
  }

  private formatToolBody(lines: string[]): StyledText {
    const chunks: TextChunk[] = [];
    lines.forEach((line, index) => {
      if (index > 0) {
        chunks.push(...stringToStyledText("\n").chunks);
      }
      if (line.startsWith("  - ")) {
        const tail = line.slice(4);
        const colonIndex = tail.indexOf(":");
        if (colonIndex > 0) {
          const label = tail.slice(0, colonIndex);
          const value = tail.slice(colonIndex + 1);
          const valueWithSpace = value.startsWith(" ") ? value : ` ${value}`;
          const styled = t`${dim("  - ")}${fg("#9aa0a6")(label)}:${valueWithSpace}`;
          chunks.push(...styled.chunks);
        } else {
          const styled = t`${dim("  - ")}${tail}`;
          chunks.push(...styled.chunks);
        }
        return;
      }

      if (line.startsWith("    ")) {
        const rest = line.slice(4);
        const styled = t`${dim("    ")}${rest}`;
        chunks.push(...styled.chunks);
        return;
      }

      chunks.push(...stringToStyledText(line).chunks);
    });
    return new StyledText(chunks);
  }

  private formatRoleLabel(role: string): StyledText {
    const color = this.colorForRole(role);
    return t`${dim("[")}${fg(color)(role)}${dim("]")} `;
  }

  private colorForRole(role: string): string {
    switch (role) {
      case "assistant":
        return "#9ecbff";
      case "user":
        return "#a3d9a5";
      case "tool":
        return "#7aa2b8";
      case "error":
        return "#cc6666";
      default:
        return "#b0b0b0";
    }
  }

  private countMessageLines(message: DisplayMessage): number {
    if (!message.content) {
      return 1;
    }
    return message.content.split("\n").length;
  }

  private trimHistory(): void {
    if (this.maxHistoryLines <= 0 || this.messages.length === 0) {
      return;
    }
    const lineCounts = this.messages.map((message) => this.countMessageLines(message));
    let totalLines =
      lineCounts.reduce((sum, count) => sum + count, 0) + Math.max(0, this.messages.length - 1);
    if (totalLines <= this.maxHistoryLines) {
      return;
    }

    let removeCount = 0;
    while (removeCount < this.messages.length && totalLines > this.maxHistoryLines) {
      totalLines -= lineCounts[removeCount];
      if (this.messages.length - removeCount - 1 > 0) {
        totalLines -= 1;
      }
      removeCount += 1;
    }

    if (removeCount <= 0) {
      return;
    }

    this.messages = this.messages.slice(removeCount);
    const updated = new Map<string, { index: number; toolName: string; args: unknown }>();
    for (const [toolCallId, entry] of this.toolCallEntries.entries()) {
      const nextIndex = entry.index - removeCount;
      if (nextIndex >= 0) {
        updated.set(toolCallId, { ...entry, index: nextIndex });
      }
    }
    this.toolCallEntries = updated;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return "Unknown error";
    }
  }

  private setStatus(text: string): void {
    if (this.statusView) {
      this.statusView.content = text;
      this.renderer?.requestRender();
    }
  }

  private render(): void {
    if (!this.messagesView || !this.renderer) {
      return;
    }
    this.trimHistory();
    const chunks = this.messages.flatMap((message, index) => {
      const styled = this.formatDisplayMessage(message);
      if (index === 0) {
        return styled.chunks;
      }
      return [...stringToStyledText("\n\n").chunks, ...styled.chunks];
    });
    this.messagesView.content = new StyledText(chunks);
    this.renderer.requestRender();
  }
}
