import {
  ScrollBoxRenderable,
  StyledText,
  bold,
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
import {
  Box,
  MarkdownBlock,
  TextBlock,
  TextareaField,
  TruncatedText,
  buildFooterText,
  buildStatusText,
} from "./components";
import { colors } from "./theme";
import { formatToolContent, formatToolStyledText } from "./tool-call-formatter";

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
  private headerBox?: Box;
  private headerText?: TextBlock;
  private bottomPane?: Box;
  private statusBar?: Box;
  private statusText?: TruncatedText;
  private queuedBox?: Box;
  private queuedText?: TextBlock;
  private footerText?: TextBlock;
  private composerBox?: Box;
  private composerRow?: Box;
  private composerPrefix?: TextBlock;
  private input?: TextareaField;
  private messages: MessageEntry[] = [];
  private messageId = 0;
  private currentAssistantIndex?: number;
  private unsubscribe?: () => void;
  private isStreaming = false;
  private inputHeight = 1;
  private statusHeight = 1;
  private toolCallEntries = new Map<string, { index: number; toolName: string; args: unknown }>();
  private subagentEntries = new Map<string, { index: number; subagentId: string }>();
  private subagentToolCallIds = new Set<string>();
  private maxHistoryLines = 2000;
  private isStopped = false;
  private statusMessage = "Ready";
  private statusStartedAt?: number;
  private statusTimer?: ReturnType<typeof setInterval>;
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
          foregroundColor: colors.dim,
          backgroundColor: "transparent",
        },
      },
    });
    this.headerBox = new Box(this.renderer, {
      id: "session-header",
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      paddingX: 1,
      paddingY: 0,
      marginBottom: 1,
    });
    this.headerText = new TextBlock(this.renderer, {
      text: "",
      width: "100%",
      wrapMode: "word",
    });
    this.headerBox.add(this.headerText);
    this.scrollBox.add(this.headerBox);
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
    this.statusText = new TruncatedText(this.renderer, {
      text: TuiApp.queueHintText,
      flexGrow: 1,
    });
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
      fg: colors.muted,
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
    this.composerBox = new Box(this.renderer, {
      id: "composer-box",
      width: "100%",
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      focusedBorderColor: colors.accent,
      paddingX: 1,
      paddingY: 0,
      marginTop: 1,
    });
    this.composerRow = new Box(this.renderer, {
      id: "composer-row",
      width: "100%",
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 1,
    });
    this.composerPrefix = new TextBlock(this.renderer, {
      text: t`${dim("›")}`,
      width: 2,
    });
    this.input = new TextareaField(this.renderer, {
      id: "input",
      width: "100%",
      height: this.inputHeight,
      flexGrow: 1,
      placeholder: "Ask Agentik to do anything",
      backgroundColor: "transparent",
      focusedBackgroundColor: "transparent",
      placeholderColor: colors.muted,
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
      fg: colors.muted,
      wrapMode: "none",
      paddingX: 1,
    });
    this.composerRow.add(this.composerPrefix);
    this.composerRow.add(this.input);
    this.composerBox.add(this.composerRow);
    this.bottomPane.add(this.statusBar);
    this.bottomPane.add(this.queuedBox);
    this.bottomPane.add(this.composerBox);
    this.bottomPane.add(this.footerText);
    this.root.add(this.scrollBox);
    this.root.add(this.divider);
    this.root.add(this.bottomPane);
    this.renderer.root.add(this.root);
    this.renderer.start();
    this.input.focus();
    this.setStatus("Ready");
    this.updateInputHeight();
    this.updateSessionHeader();
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
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = undefined;
    }
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
    this.headerBox = undefined;
    this.headerText = undefined;
    this.bottomPane = undefined;
    this.statusBar = undefined;
    this.statusText = undefined;
    this.input = undefined;
    this.composerBox = undefined;
    this.composerRow = undefined;
    this.composerPrefix = undefined;
    this.footerText = undefined;
    this.messages = [];
    this.currentAssistantIndex = undefined;
    this.isStreaming = false;
    this.toolCallEntries.clear();
    this.subagentEntries.clear();
    this.subagentToolCallIds.clear();
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
    this.statusStartedAt = Date.now();
    this.startStatusTimer();
    this.clearExitHint();
    this.setStatus("Working");
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
      this.updateFooter();
      this.renderer?.requestRender();
      return;
    }
    const header = `Queued messages (${this.queuedMessages.length}) • Up Arrow to edit last`;
    const lines = this.queuedMessages.map(
      (item, index) => `${index + 1}. [${item.mode}] ${item.content}`
    );
    this.queuedText.setText([header, ...lines].join("\n"));
    this.queuedBox.visible = true;
    this.updateFooter();
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
        this.statusStartedAt = Date.now();
        this.startStatusTimer();
        this.clearExitHint();
        this.setStatus("Working");
        break;
      }
      case "agent_end": {
        this.isStreaming = false;
        this.isAborting = false;
        this.abortController = undefined;
        this.statusStartedAt = undefined;
        this.stopStatusTimer();
        this.setStatus("Ready");
        break;
      }
      case "turn_start": {
        this.isStreaming = true;
        this.statusStartedAt ??= Date.now();
        this.startStatusTimer();
        this.clearExitHint();
        this.setStatus("Working");
        break;
      }
      case "turn_end": {
        this.setStatus(this.isStreaming ? "Working" : "Ready");
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
        if (this.subagentToolCallIds.has(event.toolCallId)) {
          break;
        }
        const content = formatToolContent({
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
        this.setStatus(this.formatToolStatus(event.toolName, event.args, "running"));
        this.render();
        break;
      }
      case "stream_part": {
        break;
      }
      case "tool_execution_update": {
        if (this.subagentToolCallIds.has(event.toolCallId)) {
          break;
        }
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
        if (this.subagentToolCallIds.has(event.toolCallId)) {
          break;
        }
        this.upsertToolEntry({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: event.isError ? "error" : "done",
          output: this.extractToolOutput(event.result),
        });
        this.toolCallEntries.delete(event.toolCallId);
        if (this.isStreaming) {
          this.setStatus("Working");
        } else {
          this.setStatus("Ready");
        }
        this.render();
        break;
      }
      case "subagent_start":
      case "subagent_update":
      case "subagent_end": {
        if (event.type === "subagent_start") {
          this.subagentToolCallIds.add(event.toolCallId);
          const role = `subagent:${event.subagentId}`;
          const existingTool = this.toolCallEntries.get(event.toolCallId);
          let index: number;
          if (existingTool) {
            const entry = this.messages[existingTool.index];
            entry.role = role;
            entry.label?.setText(this.formatRoleLabel(role));
            this.applyMessageContent(entry, "");
            this.toolCallEntries.delete(event.toolCallId);
            index = existingTool.index;
          } else {
            const messageEntry = this.createMessageEntry({ role, content: "" });
            index = this.messages.push(messageEntry) - 1;
          }
          this.subagentEntries.set(event.toolCallId, { index, subagentId: event.subagentId });
          this.setStatus(`Subagent: ${event.subagentId}`);
          this.render();
          break;
        }
        if (event.type === "subagent_update") {
          const existing = this.subagentEntries.get(event.toolCallId);
          const role = `subagent:${event.subagentId}`;
          if (!existing) {
            const messageEntry = this.createMessageEntry({ role, content: event.delta });
            const index = this.messages.push(messageEntry) - 1;
            this.subagentEntries.set(event.toolCallId, { index, subagentId: event.subagentId });
            this.render();
            break;
          }
          const entry = this.messages[existing.index];
          entry.role = role;
          entry.content = event.delta;
          this.applyMessageContent(entry, entry.content);
          this.render();
          break;
        }
        const existing = this.subagentEntries.get(event.toolCallId);
        const role = `subagent:${event.subagentId}`;
        const output = event.output?.trim().length
          ? event.output
          : event.isError
            ? "Subagent error."
            : "";
        if (!existing) {
          const messageEntry = this.createMessageEntry({ role, content: output });
          this.messages.push(messageEntry);
        } else {
          const entry = this.messages[existing.index];
          entry.role = role;
          this.applyMessageContent(entry, output);
        }
        this.subagentEntries.delete(event.toolCallId);
        this.subagentToolCallIds.delete(event.toolCallId);
        if (event.isError) {
          this.setStatus(`Subagent ${event.subagentId} error`);
        } else if (this.isStreaming) {
          this.setStatus("Working");
        } else {
          this.setStatus("Ready");
        }
        this.render();
        break;
      }
      case "error": {
        if (this.isAborting && this.isAbortError(event.error)) {
          this.isAborting = false;
          this.abortController = undefined;
          this.isStreaming = false;
          this.statusStartedAt = undefined;
          this.stopStatusTimer();
          this.setStatus("Ready");
          this.render();
          break;
        }
        this.isStreaming = false;
        this.statusStartedAt = undefined;
        this.stopStatusTimer();
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
    const showLabel = this.shouldShowLabel(message.role);
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

    const label = showLabel
      ? new TruncatedText(this.renderer, {
          width: "100%",
          text: this.formatRoleLabel(message.role),
        })
      : undefined;

    let body: TextBlock | MarkdownBlock;
    if (kind === "markdown") {
      body = new MarkdownBlock(this.renderer, {
        content: "",
        paddingX: showLabel ? 1 : 0,
        paddingY: 0,
        streaming: message.role === "assistant",
      });
    } else {
      body = new TextBlock(this.renderer, {
        text: "",
        paddingX: showLabel ? 1 : 0,
        paddingY: 0,
      });
    }

    if (label) {
      container.add(label);
    }
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
          content: formatToolContent({
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
    const content = formatToolContent({
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

  private shouldShowLabel(role: string): boolean {
    if (role === "tool" || role.startsWith("subagent:")) {
      return false;
    }
    return true;
  }

  private formatTextBody(role: string, content: string): string | StyledText {
    if (role === "tool") {
      return formatToolStyledText(content);
    }
    if (role === "error") {
      return t`${fg(colors.error)(content)}`;
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

  private extractToolOutput(value: unknown): unknown {
    if (value && typeof value === "object" && "output" in value) {
      return (value as { output?: unknown }).output;
    }
    return value;
  }

  private formatToolStatus(
    toolName: string,
    args: unknown,
    status: "running" | "done" | "error"
  ): string {
    const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const path = typeof record.path === "string" ? record.path : undefined;
    const pattern = typeof record.pattern === "string" ? record.pattern : undefined;
    const command = typeof record.command === "string" ? record.command : undefined;
    const url = typeof record.url === "string" ? record.url : undefined;

    if (toolName === "read" || toolName === "list") {
      return `Exploring ${path ?? "."}`;
    }
    if (toolName === "glob") {
      if (pattern && path) {
        return `Searching ${pattern} in ${path}`;
      }
      if (pattern) {
        return `Searching ${pattern}`;
      }
      return `Searching ${path ?? "."}`;
    }
    if (toolName === "bash") {
      return command ? `Running ${command}` : "Running command";
    }
    if (toolName === "webfetch") {
      return url ? `Fetching ${url}` : "Fetching URL";
    }
    if (status === "error") {
      return `Error running ${toolName}`;
    }
    return "Working";
  }

  private formatRoleLabel(role: string): StyledText {
    const color = this.colorForRole(role);
    return t`${dim("[")}${fg(color)(role)}${dim("]")}`;
  }

  private colorForRole(role: string): string {
    if (role.startsWith("subagent:")) {
      return colors.codex;
    }
    switch (role) {
      case "assistant":
        return "white";
      case "user":
        return colors.accent;
      case "tool":
        return colors.muted;
      case "error":
        return colors.error;
      default:
        return colors.muted;
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
    const updatedSubagents = new Map<string, { index: number; subagentId: string }>();
    for (const [toolCallId, entry] of this.subagentEntries.entries()) {
      const nextIndex = entry.index - removeCount;
      if (nextIndex >= 0) {
        updatedSubagents.set(toolCallId, { ...entry, index: nextIndex });
      }
    }
    this.subagentEntries = updatedSubagents;
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

  private updateSessionHeader(): void {
    if (!this.headerBox || !this.headerText || !this.renderer) {
      return;
    }
    const width = Math.max(20, Math.min(60, this.renderer.terminalWidth - 2));
    this.headerBox.width = width;
    this.headerText.setText(this.buildSessionHeaderText());
  }

  private buildSessionHeaderText(): StyledText {
    const version = this.getVersionLabel();
    const modelLabel = this.getModelLabel();
    const thinking = this.agent.state.thinkingLevel;
    const modelLine = thinking ? `${modelLabel} ${thinking}` : modelLabel;
    const directory = this.formatDirectory(process.cwd());

    const title = t`${dim(">_ ")}${bold("Agentik")}${dim(` (${version})`)}`;
    const modelRow = t`${dim("model: ")}${fg(colors.accent)(
      modelLine
    )}${dim("   ")}${fg(colors.accent)("/model")}${dim(" to change")}`;
    const dirRow = t`${dim("directory: ")}${directory}`;

    return this.joinStyledLines([title, stringToStyledText(""), modelRow, dirRow]);
  }

  private joinStyledLines(lines: StyledText[]): StyledText {
    const chunks: TextChunk[] = [];
    lines.forEach((line, index) => {
      chunks.push(...line.chunks);
      if (index < lines.length - 1) {
        chunks.push(...stringToStyledText("\n").chunks);
      }
    });
    return new StyledText(chunks);
  }

  private getModelLabel(): string {
    const model = this.agent.state.model;
    if (typeof model === "string") {
      return model;
    }
    if (model && typeof model === "object") {
      const record = model as { modelId?: string; id?: string };
      if (record.modelId) {
        return record.modelId;
      }
      if (record.id) {
        return record.id;
      }
    }
    return "unknown";
  }

  private getVersionLabel(): string {
    return process.env.AGENTIK_VERSION ?? "dev";
  }

  private formatDirectory(value: string): string {
    const home = process.env.HOME;
    if (home && value.startsWith(home)) {
      return `~${value.slice(home.length)}`;
    }
    return value;
  }

  private setStatus(text: string): void {
    const nextText = this.exitHintActive && text === "Ready" ? TuiApp.exitHintText : text;
    this.statusMessage = nextText;
    this.updateStatusText();
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

  private formatElapsed(elapsedMs: number): string {
    const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
    if (seconds < 60) {
      return `${seconds}s`;
    }
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainder = seconds % 60;
      return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return `${hours}h ${minutes.toString().padStart(2, "0")}m ${remainder
      .toString()
      .padStart(2, "0")}s`;
  }

  private updateStatusText(): void {
    if (!this.statusText) {
      return;
    }
    const elapsed =
      this.isStreaming && this.statusStartedAt
        ? this.formatElapsed(Date.now() - this.statusStartedAt)
        : undefined;
    this.statusText.setText(
      buildStatusText({
        header: this.statusMessage,
        elapsed,
        showInterruptHint: this.isStreaming,
      })
    );
    this.updateFooter();
    this.renderer?.requestRender();
  }

  private startStatusTimer(): void {
    if (this.statusTimer) {
      return;
    }
    this.statusTimer = setInterval(() => {
      if (!this.isStreaming) {
        return;
      }
      this.updateStatusText();
    }, 1000);
  }

  private stopStatusTimer(): void {
    if (!this.statusTimer) {
      return;
    }
    clearInterval(this.statusTimer);
    this.statusTimer = undefined;
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
    this.statusStartedAt = undefined;
    this.stopStatusTimer();
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
    if (this.composerRow) {
      this.composerRow.height = nextHeight;
    }
    if (this.composerBox) {
      this.composerBox.height = nextHeight + 2;
    }
    this.render();
  }

  private updateFooter(): void {
    if (!this.footerText || !this.renderer) {
      return;
    }
    const styled = buildFooterText({
      queuedCount: this.queuedMessages.length,
      width: Math.max(0, this.renderer.terminalWidth - 2),
    });
    this.footerText.setText(styled);
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
    this.updateSessionHeader();
    this.updateFooter();
    this.renderer?.requestRender();
  }
}
