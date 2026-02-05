import {
  ScrollBoxRenderable,
  StyledText,
  createCliRenderer,
  CliRenderEvents,
  dim,
  fg,
  stringToStyledText,
  t,
  type KeyBinding,
  type TextChunk,
  type CliRenderer,
} from "@opentui/core";
import type { Agent, AgentEvent, AgentMessage } from "@agentik/runtime";
import { Box, Loader, MarkdownBlock, TextBlock, TextareaField, TruncatedText } from "./components";

type DisplayMessage = {
  role: string;
  content: string;
};

type MessageKind = "markdown" | "text";

type MessageEntry = DisplayMessage & {
  id: string;
  kind: MessageKind;
  container?: Box;
  label?: TruncatedText;
  body?: TextBlock | MarkdownBlock;
};

export type TuiAppOptions = {
  agent: Agent;
};

export class TuiApp {
  private agent: Agent;
  private renderer?: CliRenderer;
  private root?: Box;
  private scrollBox?: ScrollBoxRenderable;
  private divider?: TextBlock;
  private bottomPane?: Box;
  private statusBar?: Box;
  private statusText?: TruncatedText;
  private statusLoader?: Loader;
  private queuedBox?: Box;
  private queuedText?: TextBlock;
  private footerText?: TextBlock;
  private input?: TextareaField;
  private messages: MessageEntry[] = [];
  private messageId = 0;
  private currentAssistantIndex?: number;
  private unsubscribe?: () => void;
  private isStreaming = false;
  private inputHeight = 1;
  private statusHeight = 1;
  private toolCallEntries = new Map<string, { index: number; toolName: string; args: unknown }>();
  private maxHistoryLines = 2000;
  private isStopped = false;
  private queuedMessages: Array<{ mode: "steering" | "follow-up"; content: string }> = [];
  private handleRendererDestroy = () => {
    if (this.isStopped) {
      return;
    }
    this.shutdown({ destroyRenderer: false });
  };
  private abortController?: AbortController;
  private isAborting = false;
  private lastCtrlCAt?: number;
  private exitHintTimeout?: ReturnType<typeof setTimeout>;
  private exitHintActive = false;
  private static readonly exitHintText = "Press Ctrl+C again to exit";
  private static readonly queueHintText = "";

  constructor(options: TuiAppOptions) {
    this.agent = options.agent;
  }

  async start(): Promise<void> {
    if (this.renderer) {
      return;
    }
    this.isStopped = false;
    this.renderer = await createCliRenderer({ exitOnCtrlC: false });
    this.renderer.on(CliRenderEvents.DESTROY, this.handleRendererDestroy);
    this.root = new Box(this.renderer, {
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
      contentOptions: {
        flexDirection: "column",
        width: "100%",
        paddingLeft: 1,
        paddingRight: 1,
      },
      scrollbarOptions: {
        trackOptions: {
          foregroundColor: "#3b4252",
          backgroundColor: "#1f2328",
        },
      },
    });
    this.divider = new TextBlock(this.renderer, {
      text: "",
      width: "100%",
    });
    this.bottomPane = new Box(this.renderer, {
      id: "bottom-pane",
      width: "100%",
      flexDirection: "column",
    });
    this.statusBar = new Box(this.renderer, {
      id: "status",
      width: "100%",
      height: this.statusHeight,
      flexDirection: "row",
      alignItems: "center",
      gap: 1,
      paddingX: 1,
    });
    this.statusLoader = new Loader(this.renderer, {
      message: "",
      frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
      frameColor: "#7aa2b8",
      messageColor: "#9aa0a6",
    });
    this.statusLoader.stop();
    this.statusLoader.view.visible = false;
    this.statusLoader.view.content = "";
    this.statusText = new TruncatedText(this.renderer, {
      text: TuiApp.queueHintText,
      flexGrow: 1,
    });
    this.statusBar.add(this.statusLoader.view);
    this.statusBar.add(this.statusText);
    this.queuedBox = new Box(this.renderer, {
      id: "queued",
      width: "100%",
      flexDirection: "column",
      paddingX: 1,
    });
    this.queuedText = new TextBlock(this.renderer, {
      text: "",
      width: "100%",
      fg: "#9aa0a6",
      wrapMode: "word",
    });
    this.queuedBox.add(this.queuedText);
    this.queuedBox.visible = false;
    const composerBindings: KeyBinding[] = [
      { name: "return", action: "submit" },
      { name: "linefeed", action: "submit" },
      { name: "return", shift: true, action: "newline" },
      { name: "linefeed", shift: true, action: "newline" },
    ];
    this.input = new TextareaField(this.renderer, {
      id: "input",
      width: "100%",
      height: this.inputHeight,
      placeholder: "Type a message. Shift+Enter for newline...",
      backgroundColor: "transparent",
      placeholderColor: "brightBlack",
      wrapMode: "word",
      keyBindings: composerBindings,
      onSubmitText: (value) => {
        this.handleInputSubmit(value, "steering", { clearOnEmpty: true });
      },
      onChangeText: () => this.updateInputHeight(),
    });
    this.footerText = new TextBlock(this.renderer, {
      text: "",
      width: "100%",
      fg: "#9aa0a6",
      wrapMode: "none",
      paddingX: 1,
    });
    this.bottomPane.add(this.statusBar);
    this.bottomPane.add(this.queuedBox);
    this.bottomPane.add(this.input);
    this.bottomPane.add(this.footerText);
    this.root.add(this.scrollBox);
    this.root.add(this.divider);
    this.root.add(this.bottomPane);
    this.renderer.root.add(this.root);
    this.renderer.start();
    this.input.focus();
    this.updateInputHeight();
    this.renderer.on("resize", () => this.render());
    this.renderer.keyInput.on("keypress", (key) => {
      if (key.name === "c" && key.ctrl) {
        key.preventDefault();
        key.stopPropagation();
        this.handleCtrlC();
        return;
      }
      const isEnter = key.name === "return" || key.name === "enter";
      const alt = (key as { alt?: boolean }).alt ?? false;
      if (isEnter && alt && this.input) {
        const value = this.input.plainText;
        if (!value.trim()) {
          return;
        }
        key.preventDefault();
        key.stopPropagation();
        this.handleInputSubmit(value, "follow-up", { clearOnEmpty: false });
        return;
      }
      if (key.name === "escape") {
        if (this.isStreaming) {
          key.preventDefault();
          key.stopPropagation();
          this.interruptCurrentResponse("Esc");
        }
        return;
      }
      if (!this.scrollBox) {
        return;
      }
      const name = key.name;
      if (name === "up" && this.input && this.queuedMessages.length > 0) {
        key.preventDefault();
        key.stopPropagation();
        const dequeued = this.queuedMessages.pop();
        if (dequeued) {
          if (dequeued.mode === "steering") {
            this.agent.dequeueLastSteeringMessage();
          } else {
            this.agent.dequeueLastFollowUpMessage();
          }
          this.input.setText(dequeued.content);
          this.input.cursorOffset = this.input.plainText.length;
          this.renderQueuedMessages();
          this.setStatus(`Dequeued ${dequeued.mode} message for editing.`);
        }
        return;
      }
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
    this.unsubscribe = this.agent.subscribe((event) => this.handleEvent(event));
  }

  stop(): void {
    this.shutdown({ destroyRenderer: true });
  }

  private shutdown(options: { destroyRenderer: boolean }): void {
    if (this.isStopped) {
      return;
    }
    this.isStopped = true;
    this.abortController?.abort();
    this.abortController = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.statusLoader?.destroy();
    if (this.renderer) {
      this.renderer.off(CliRenderEvents.DESTROY, this.handleRendererDestroy);
      if (options.destroyRenderer) {
        this.renderer.destroy();
      }
    }
    this.renderer = undefined;
    this.root = undefined;
    this.scrollBox = undefined;
    this.divider = undefined;
    this.bottomPane = undefined;
    this.statusBar = undefined;
    this.statusText = undefined;
    this.statusLoader = undefined;
    this.input = undefined;
    this.footerText = undefined;
    this.messages = [];
    this.currentAssistantIndex = undefined;
    this.isStreaming = false;
    this.toolCallEntries.clear();
    this.queuedMessages = [];
    if (this.exitHintTimeout) {
      clearTimeout(this.exitHintTimeout);
      this.exitHintTimeout = undefined;
    }
    this.exitHintActive = false;
  }

  private clearInput(): void {
    if (this.input) {
      this.input.setText("");
    }
  }

  private handleInputSubmit(
    value: string,
    mode: "steering" | "follow-up",
    options: { clearOnEmpty: boolean }
  ): void {
    const trimmed = value.trim();
    if (!trimmed) {
      if (options.clearOnEmpty) {
        this.clearInput();
      }
      return;
    }
    if (this.isStreaming) {
      this.queueMessage(trimmed, mode);
      this.clearInput();
      return;
    }
    this.clearInput();
    this.submitPrompt(trimmed);
  }

  private submitPrompt(prompt: string): void {
    this.isStreaming = true;
    this.clearExitHint();
    this.setStatus("Thinking...");
    this.abortController?.abort();
    this.abortController = new AbortController();
    void this.agent.prompt(prompt, { abortSignal: this.abortController.signal }).catch((error) => {
      if (this.isAbortError(error)) {
        return;
      }
      console.error("Prompt failed:", error);
      this.isStreaming = false;
      this.setStatus(`Error: ${this.formatError(error)}`);
      this.render();
    });
  }

  private queueMessage(text: string, mode: "steering" | "follow-up"): void {
    if (mode === "steering") {
      this.agent.enqueueSteeringMessage(text);
    } else {
      this.agent.enqueueFollowUpMessage(text);
    }
    this.queuedMessages.push({ mode, content: text });
    this.renderQueuedMessages();
    const counts = this.agent.getQueueCounts();
    this.setStatus(
      `Queued ${mode} message. Steering: ${counts.steering}, Follow-up: ${counts.followUp}`
    );
  }

  private renderQueuedMessages(): void {
    if (!this.queuedBox || !this.queuedText) {
      return;
    }
    if (this.queuedMessages.length === 0) {
      this.queuedBox.visible = false;
      this.queuedText.setText("");
      this.renderer?.requestRender();
      return;
    }
    const header = `Queued messages (${this.queuedMessages.length}) • Up Arrow to edit last`;
    const lines = this.queuedMessages.map(
      (item, index) => `${index + 1}. [${item.mode}] ${item.content}`
    );
    this.queuedText.setText([header, ...lines].join("\n"));
    this.queuedBox.visible = true;
    this.renderer?.requestRender();
  }

  private consumeQueuedMessageIfMatches(message: AgentMessage): void {
    if (this.queuedMessages.length === 0) {
      return;
    }
    if (message == null || typeof message !== "object") {
      return;
    }
    const role = (message as { role?: string }).role;
    if (role !== "user") {
      return;
    }
    const content = (message as { content?: unknown }).content;
    if (typeof content !== "string") {
      return;
    }
    const queued = this.queuedMessages[0];
    if (queued && queued.content === content) {
      this.queuedMessages.shift();
      this.renderQueuedMessages();
    }
  }

  private handleEvent(event: AgentEvent): void {
    if (this.isStopped) {
      return;
    }
    switch (event.type) {
      case "agent_start": {
        this.isStreaming = true;
        this.clearExitHint();
        this.setStatus("Thinking...");
        break;
      }
      case "agent_end": {
        this.isStreaming = false;
        this.isAborting = false;
        this.abortController = undefined;
        this.setStatus("Ready");
        break;
      }
      case "turn_start": {
        this.isStreaming = true;
        this.clearExitHint();
        this.setStatus("Thinking...");
        break;
      }
      case "turn_end": {
        this.setStatus(this.isStreaming ? "Thinking..." : "Ready");
        break;
      }
      case "message_start": {
        this.consumeQueuedMessageIfMatches(event.message);
        if (this.isToolMessage(event.message)) {
          break;
        }
        const entry = this.formatMessage(event.message);
        const messageEntry = this.createMessageEntry(entry);
        this.messages.push(messageEntry);
        if (entry.role === "assistant") {
          this.currentAssistantIndex = this.messages.length - 1;
        }
        this.render();
        break;
      }
      case "message_update": {
        if (this.isAborting) {
          break;
        }
        if (this.currentAssistantIndex != null) {
          const entry = this.messages[this.currentAssistantIndex];
          entry.content += event.delta;
          this.applyMessageContent(entry, entry.content);
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
            const removed = this.messages.pop();
            if (removed?.container) {
              this.scrollBox?.remove(removed.container.id);
            }
            this.currentAssistantIndex = undefined;
            this.render();
            break;
          }
          const existing = this.messages[this.messages.length - 1];
          existing.role = entry.role;
          this.applyMessageContent(existing, entry.content);
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
        const messageEntry = this.createMessageEntry({ role: "tool", content });
        const index = this.messages.push(messageEntry) - 1;
        this.toolCallEntries.set(event.toolCallId, {
          index,
          toolName: event.toolName,
          args: event.args,
        });
        this.setStatus(`Tool: ${event.toolName}`);
        this.render();
        break;
      }
      case "stream_part": {
        break;
      }
      case "tool_execution_update": {
        this.upsertToolEntry({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: "running",
          output: this.extractToolOutput(event.partialResult),
        });
        this.render();
        break;
      }
      case "tool_execution_end": {
        this.upsertToolEntry({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: event.isError ? "error" : "done",
          output: this.extractToolOutput(event.result),
        });
        this.toolCallEntries.delete(event.toolCallId);
        if (this.isStreaming) {
          this.setStatus("Thinking...");
        } else {
          this.setStatus("Ready");
        }
        this.render();
        break;
      }
      case "subagent_start":
      case "subagent_update":
      case "subagent_end": {
        break;
      }
      case "error": {
        if (this.isAborting && this.isAbortError(event.error)) {
          this.isAborting = false;
          this.abortController = undefined;
          this.isStreaming = false;
          this.setStatus("Ready");
          this.render();
          break;
        }
        this.isStreaming = false;
        const message = this.formatError(event.error);
        const entry = this.createMessageEntry({ role: "error", content: message });
        this.messages.push(entry);
        this.setStatus(`Error: ${message}`);
        this.render();
        break;
      }
      default: {
        const _exhaustive: never = event;
        return _exhaustive;
      }
    }
  }

  private createMessageEntry(message: DisplayMessage): MessageEntry {
    const kind = this.kindForRole(message.role);
    const entry: MessageEntry = {
      id: `message-${this.messageId++}`,
      role: message.role,
      content: message.content,
      kind,
    };

    if (!this.renderer || !this.scrollBox) {
      return entry;
    }

    const container = new Box(this.renderer, {
      id: entry.id,
      width: "100%",
      flexDirection: "column",
      marginBottom: 1,
    });

    const label = new TruncatedText(this.renderer, {
      width: "100%",
      text: this.formatRoleLabel(message.role),
    });

    let body: TextBlock | MarkdownBlock;
    if (kind === "markdown") {
      body = new MarkdownBlock(this.renderer, {
        content: "",
        paddingX: 1,
        paddingY: 0,
        streaming: message.role === "assistant",
      });
    } else {
      body = new TextBlock(this.renderer, {
        text: "",
        paddingX: 1,
        paddingY: 0,
      });
    }

    container.add(label);
    container.add(body);
    this.scrollBox.add(container);

    entry.container = container;
    entry.label = label;
    entry.body = body;

    this.applyMessageContent(entry, message.content);

    return entry;
  }

  private upsertToolEntry(options: {
    toolCallId: string;
    toolName: string;
    status: "running" | "done" | "error";
    args?: unknown;
    output?: unknown;
  }): void {
    const existing = this.toolCallEntries.get(options.toolCallId);
    const args = options.args ?? existing?.args;
    const index =
      existing?.index ??
      this.messages.push(
        this.createMessageEntry({
          role: "tool",
          content: this.formatToolContent({
            toolName: options.toolName,
            status: options.status,
            args,
          }),
        })
      ) - 1;
    if (!existing) {
      this.toolCallEntries.set(options.toolCallId, {
        index,
        toolName: options.toolName,
        args,
      });
    }
    const content = this.formatToolContent({
      toolName: options.toolName,
      status: options.status,
      args,
      output: options.output,
    });
    this.applyMessageContent(this.messages[index], content);
  }

  private applyMessageContent(entry: MessageEntry, content: string): void {
    entry.content = content;
    if (!entry.body) {
      return;
    }

    if (entry.kind === "markdown" && entry.body instanceof MarkdownBlock) {
      entry.body.setContent(content);
      return;
    }

    if (entry.body instanceof TextBlock) {
      entry.body.setText(this.formatTextBody(entry.role, content));
    }
  }

  private kindForRole(role: string): MessageKind {
    if (role === "assistant" || role === "user") {
      return "markdown";
    }
    return "text";
  }

  private formatTextBody(role: string, content: string): string | StyledText {
    if (role === "tool") {
      return this.formatToolStyledText(content);
    }
    if (role === "error") {
      return t`${fg("#cc6666")(content)}`;
    }
    return content;
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
    return this.formatUnknown(value, { errorFallback: "Error" });
  }

  private pushSummaryLine(lines: string[], label: string, value: unknown): void {
    if (value === undefined || value === null || value === "") {
      return;
    }
    lines.push(`  - ${label}: ${this.formatValue(value)}`);
  }

  private summarizeToolArgs(toolName: string, args: unknown): string[] {
    if (!args || typeof args !== "object") {
      return [];
    }
    const record = args as Record<string, unknown>;
    switch (toolName) {
      case "read":
      case "write":
      case "edit":
      case "update":
        return this.summarizePathArgs(record);
      case "list":
        return this.summarizeListArgs(record);
      case "glob":
        return this.summarizeGlobArgs(record);
      case "bash":
        return this.summarizeBashArgs(record);
      case "webfetch":
        return this.summarizeWebFetchArgs(record);
      default:
        return this.summarizeGenericArgs(args);
    }
  }

  private summarizeToolOutput(
    toolName: string,
    output: unknown,
    status: "running" | "done" | "error",
    args?: unknown
  ): string[] {
    if (status === "error") {
      return this.summarizeErrorOutput(output);
    }

    switch (toolName) {
      case "read": {
        return this.summarizeReadToolOutput(output, args);
      }
      case "list": {
        return this.summarizeCountOutput(output, "entries");
      }
      case "glob": {
        return this.summarizeCountOutput(output, "matches");
      }
      case "webfetch": {
        return this.summarizeWebFetchOutput(output);
      }
      case "bash": {
        return this.summarizeBashOutput(output);
      }
      case "write":
      case "edit":
      case "update": {
        return this.summarizeResultOutput(output);
      }
      default: {
        return this.summarizeResultOutput(output);
      }
    }
  }

  private summarizePathArgs(record: Record<string, unknown>): string[] {
    const lines: string[] = [];
    this.pushSummaryLine(lines, "path", record.path);
    return lines;
  }

  private summarizeListArgs(record: Record<string, unknown>): string[] {
    const lines: string[] = [];
    this.pushSummaryLine(lines, "path", record.path ?? ".");
    if (record.limit != null) {
      this.pushSummaryLine(lines, "limit", record.limit);
    }
    return lines;
  }

  private summarizeGlobArgs(record: Record<string, unknown>): string[] {
    const lines: string[] = [];
    this.pushSummaryLine(lines, "pattern", record.pattern);
    this.pushSummaryLine(lines, "path", record.path ?? ".");
    if (record.limit != null) {
      this.pushSummaryLine(lines, "limit", record.limit);
    }
    return lines;
  }

  private summarizeBashArgs(record: Record<string, unknown>): string[] {
    const lines: string[] = [];
    this.pushSummaryLine(lines, "command", record.command);
    return lines;
  }

  private summarizeWebFetchArgs(record: Record<string, unknown>): string[] {
    const lines: string[] = [];
    this.pushSummaryLine(lines, "url", record.url);
    if (record.method && record.method !== "GET") {
      this.pushSummaryLine(lines, "method", record.method);
    }
    return lines;
  }

  private summarizeGenericArgs(args: unknown): string[] {
    const lines: string[] = [];
    this.pushSummaryLine(lines, "args", args);
    return lines;
  }

  private summarizeErrorOutput(output: unknown): string[] {
    if (output == null) {
      return ["  - error: unknown error"];
    }
    return [`  - error: ${this.formatValue(output)}`];
  }

  private summarizeResultOutput(output: unknown): string[] {
    if (output === undefined) {
      return [];
    }
    return [`  - result: ${this.formatValue(output)}`];
  }

  private summarizeCountOutput(output: unknown, label: string): string[] {
    if (typeof output !== "string") {
      return this.summarizeResultOutput(output);
    }
    const count = this.countPrimaryLines(output);
    return [`  - ${label}: ${count}`];
  }

  private summarizeReadToolOutput(output: unknown, args?: unknown): string[] {
    if (typeof output !== "string") {
      return this.summarizeResultOutput(output);
    }
    const { linesShown, rangeLabel } = this.summarizeReadOutput(output, args);
    const lines: string[] = [];
    if (rangeLabel) {
      lines.push(`  - range: ${rangeLabel}`);
    }
    lines.push(`  - result: ${linesShown} line${linesShown === 1 ? "" : "s"}`);
    return lines;
  }

  private summarizeWebFetchOutput(output: unknown): string[] {
    if (typeof output !== "string") {
      return this.summarizeResultOutput(output);
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

  private summarizeBashOutput(output: unknown): string[] {
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

  private formatToolStyledText(content: string): StyledText {
    const [header, ...rest] = content.split("\n");
    const headerStyled = t`${fg("#7aa2b8")(header ?? "")}`;
    const restStyled = this.formatToolBody(rest);
    const separator = rest.length > 0 ? stringToStyledText("\n") : null;
    return new StyledText([
      ...headerStyled.chunks,
      ...(separator ? separator.chunks : []),
      ...restStyled.chunks,
    ]);
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
    return t`${dim("[")}${fg(color)(role)}${dim("]")}`;
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

    const removed = this.messages.slice(0, removeCount);
    for (const entry of removed) {
      if (entry.container) {
        this.scrollBox?.remove(entry.container.id);
      }
    }

    this.messages = this.messages.slice(removeCount);

    if (this.currentAssistantIndex != null) {
      if (this.currentAssistantIndex < removeCount) {
        this.currentAssistantIndex = undefined;
      } else {
        this.currentAssistantIndex -= removeCount;
      }
    }

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
    return this.formatUnknown(error, {
      includeStack: true,
      errorFallback: "Unknown error",
      nullFallback: "Unknown error",
    });
  }

  private formatUnknown(
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

  private setStatus(text: string): void {
    const nextText = this.exitHintActive && text === "Ready" ? TuiApp.exitHintText : text;
    const displayText = nextText === "Ready" ? TuiApp.queueHintText : nextText;
    if (this.statusText) {
      this.statusText.setText(displayText);
    }
    this.updateStatusIndicator();
    this.renderer?.requestRender();
  }

  private setExitHint(): void {
    this.exitHintActive = true;
    if (this.exitHintTimeout) {
      clearTimeout(this.exitHintTimeout);
    }
    this.setStatus(TuiApp.exitHintText);
    this.exitHintTimeout = setTimeout(() => {
      this.exitHintActive = false;
      this.exitHintTimeout = undefined;
      if (!this.isStreaming) {
        this.setStatus("Ready");
      }
    }, 2000);
  }

  private clearExitHint(): void {
    if (!this.exitHintActive) {
      return;
    }
    this.exitHintActive = false;
    if (this.exitHintTimeout) {
      clearTimeout(this.exitHintTimeout);
      this.exitHintTimeout = undefined;
    }
  }

  private handleCtrlC(): void {
    const now = Date.now();
    if (this.lastCtrlCAt && now - this.lastCtrlCAt <= 2000) {
      this.shutdown({ destroyRenderer: true });
      process.exit(0);
    }
    this.lastCtrlCAt = now;
    this.setExitHint();
    if (this.isStreaming) {
      this.interruptCurrentResponse("Ctrl+C");
    }
  }

  private interruptCurrentResponse(reason: "Ctrl+C" | "Esc"): void {
    if (!this.isStreaming || this.isAborting) {
      return;
    }
    this.isAborting = true;
    this.abortController?.abort();
    this.abortController = undefined;
    this.isStreaming = false;
    this.currentAssistantIndex = undefined;
    const entry = this.createMessageEntry({
      role: "system",
      content: reason === "Ctrl+C" ? "Interrupted (Ctrl+C)" : "Interrupted (Esc)",
    });
    this.messages.push(entry);
    this.setStatus("Ready");
    this.render();
  }

  private isAbortError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }
    const record = error as { name?: string; message?: string };
    if (record.name === "AbortError") {
      return true;
    }
    if (typeof record.message === "string" && record.message.toLowerCase().includes("abort")) {
      return true;
    }
    return false;
  }

  private updateStatusIndicator(): void {
    if (!this.statusLoader) {
      return;
    }
    if (this.isStreaming) {
      this.statusLoader.view.visible = true;
      this.statusLoader.start();
    } else {
      this.statusLoader.view.visible = false;
      this.statusLoader.stop();
      this.statusLoader.view.content = "";
    }
  }

  private updateInputHeight(): void {
    if (!this.input) {
      return;
    }
    const lines = Math.max(1, this.input.virtualLineCount || 1);
    const nextHeight = Math.min(6, lines);
    if (nextHeight === this.inputHeight) {
      return;
    }
    this.inputHeight = nextHeight;
    this.input.height = nextHeight;
    this.render();
  }

  private updateDivider(): void {
    if (!this.divider || !this.renderer) {
      return;
    }
    const width = this.renderer.terminalWidth;
    if (width <= 0) {
      this.divider.setText("");
      return;
    }
    const line = "─".repeat(width);
    this.divider.setText(t`${dim(line)}`);
  }

  private render(): void {
    this.trimHistory();
    this.updateDivider();
    this.renderer?.requestRender();
  }
}
