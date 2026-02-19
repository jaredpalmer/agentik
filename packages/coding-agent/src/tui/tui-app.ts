import {
  CliRenderEvents,
  ScrollBoxRenderable,
  TextareaRenderable,
  bold,
  createCliRenderer,
  dim,
  fg,
  t,
  type CliRenderer,
  type KeyEvent,
  type StyledText,
  type TextareaAction,
} from "@opentui/core";
import type { Agent, AgentEvent, AgentMessage } from "@agentik/runtime";
import { Box, MarkdownBlock, TextBlock } from "./components";
import { colors } from "./theme";

type DisplayMessage = {
  role: string;
  content: string;
};

type MessageEntry = DisplayMessage & {
  id: string;
  container?: Box;
  body?: TextBlock | MarkdownBlock;
};

type ToolCallEntry = {
  index: number;
  toolName: string;
  args: unknown;
};

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read: "Read",
  list: "List",
  glob: "Glob",
  find: "Find",
  grep: "Grep",
  bash: "Bash",
  webfetch: "WebFetch",
  write: "Write",
  edit: "Edit",
  update: "Update",
};

const TOOL_RESULT_MAX_LINES = 4;

function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}

function truncate(value: string, max: number): string {
  const singleLine = value.replace(/\n/g, "\\n");
  return singleLine.length > max ? `${singleLine.slice(0, Math.max(0, max - 1))}…` : singleLine;
}

function summarizeToolArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") {
    return "";
  }

  const record = args as Record<string, unknown>;

  switch (toolName) {
    case "bash":
      return typeof record.command === "string" ? truncate(record.command, 60) : "";
    case "read":
    case "write":
    case "edit":
    case "update":
      return typeof record.path === "string" ? record.path : "";
    case "list":
      return typeof record.path === "string" ? record.path : ".";
    case "glob":
    case "find": {
      const pattern = typeof record.pattern === "string" ? record.pattern : "";
      const path = typeof record.path === "string" ? ` in ${record.path}` : "";
      return `${pattern}${path}`.trim();
    }
    case "grep": {
      const pattern = typeof record.pattern === "string" ? record.pattern : "";
      const path = typeof record.path === "string" ? ` in ${record.path}` : "";
      return `${pattern}${path}`.trim();
    }
    case "webfetch":
      return typeof record.url === "string" ? record.url : "";
    default:
      return "";
  }
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

function getToolResultText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  if (result == null) {
    return "";
  }

  if (typeof result === "object") {
    const record = result as {
      output?: unknown;
      content?: Array<{ type?: string; text?: unknown }>;
    };

    if ("output" in record) {
      return getToolResultText(record.output);
    }

    if (Array.isArray(record.content)) {
      const text = record.content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
      if (text.length > 0) {
        return text;
      }
    }
  }

  return formatUnknown(result, { errorFallback: "Unknown result", nullFallback: "" });
}

function getToolResultLines(result: unknown, maxLines: number): string[] {
  const text = getToolResultText(result);
  if (!text) {
    return [];
  }

  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return lines;
  }

  return [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`];
}

function summarizeToolResult(result: unknown): string {
  const text = getToolResultText(result);
  if (!text) {
    return "Unknown error";
  }

  const lines = text.split("\n");
  if (lines.length <= 3) {
    return truncate(text, 120);
  }

  return `${truncate(lines[0] ?? "", 80)} (+${lines.length - 1} lines)`;
}

export type TuiAppOptions = {
  agent: Agent;
};

export class TuiApp {
  private agent: Agent;
  private renderer?: CliRenderer;
  private root?: Box;
  private header?: TextBlock;
  private scrollBox?: ScrollBoxRenderable;
  private inputBox?: Box;
  private input?: TextareaRenderable;
  private footer?: TextBlock;

  private messages: MessageEntry[] = [];
  private messageId = 0;
  private currentAssistantIndex?: number;
  private unsubscribe?: () => void;

  private isStreaming = false;
  private isStopped = false;
  private statusMessage = "Ready";
  private statusStartedAt?: number;
  private statusTimer?: ReturnType<typeof setInterval>;
  private queuedMessages: Array<{ mode: "steering" | "follow-up"; content: string }> = [];

  private toolCallEntries = new Map<string, ToolCallEntry>();
  private subagentEntries = new Map<string, { index: number; subagentId: string }>();
  private subagentToolCallIds = new Set<string>();

  private maxHistoryLines = 2000;

  private abortController?: AbortController;
  private isAborting = false;
  private lastCtrlCAt?: number;
  private exitHintTimeout?: ReturnType<typeof setTimeout>;
  private exitHintActive = false;

  private static readonly exitHintText = "Press Ctrl+C again to exit";

  private handleRendererDestroy = () => {
    if (this.isStopped) {
      return;
    }
    this.shutdown({ destroyRenderer: false });
  };

  constructor(options: TuiAppOptions) {
    this.agent = options.agent;
  }

  async start(): Promise<void> {
    if (this.renderer) {
      return;
    }

    this.isStopped = false;
    this.renderer = await createCliRenderer({
      exitOnCtrlC: false,
      useAlternateScreen: true,
      useMouse: true,
      autoFocus: true,
    });
    this.renderer.on(CliRenderEvents.DESTROY, this.handleRendererDestroy);

    this.root = new Box(this.renderer, {
      id: "root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
    });

    this.header = new TextBlock(this.renderer, {
      id: "header",
      width: "100%",
      flexShrink: 0,
      text: this.buildHeaderContent(),
      paddingX: 1,
      paddingTop: 1,
      wrapMode: "word",
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

    this.inputBox = new Box(this.renderer, {
      id: "input-box",
      width: "100%",
      height: 4,
      flexShrink: 0,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      focusedBorderColor: colors.accent,
      paddingX: 1,
      marginTop: 1,
    });

    this.input = new TextareaRenderable(this.renderer, {
      id: "input",
      width: "100%",
      height: "100%",
      placeholder: "Ask Agentik to do anything",
      backgroundColor: "transparent",
      focusedBackgroundColor: "transparent",
      placeholderColor: colors.muted,
      wrapMode: "word",
      keyBindings: [
        { name: "return", action: "submit" satisfies TextareaAction },
        { name: "linefeed", action: "submit" satisfies TextareaAction },
        { name: "return", shift: true, action: "newline" satisfies TextareaAction },
        { name: "linefeed", shift: true, action: "newline" satisfies TextareaAction },
      ],
    });

    this.footer = new TextBlock(this.renderer, {
      id: "footer",
      width: "100%",
      flexShrink: 0,
      text: "",
      fg: colors.muted,
      wrapMode: "none",
      paddingX: 1,
    });

    this.inputBox.add(this.input);
    this.root.add(this.header);
    this.root.add(this.scrollBox);
    this.root.add(this.inputBox);
    this.root.add(this.footer);
    this.renderer.root.add(this.root);

    this.renderer.start();
    this.input.focus();

    this.setStatus("Ready");
    this.renderer.on("resize", () => this.render());
    this.wireInput();
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

    this.stopStatusTimer();

    if (this.renderer) {
      this.renderer.off(CliRenderEvents.DESTROY, this.handleRendererDestroy);
      if (options.destroyRenderer) {
        this.renderer.destroy();
      }
    }

    this.renderer = undefined;
    this.root = undefined;
    this.header = undefined;
    this.scrollBox = undefined;
    this.inputBox = undefined;
    this.input = undefined;
    this.footer = undefined;

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

  private wireInput(): void {
    if (!this.input || !this.renderer) {
      return;
    }

    this.input.onSubmit = () => {
      const value = this.input?.plainText ?? "";
      this.handleInputSubmit(value, "steering", { clearOnEmpty: true });
    };

    this.renderer.keyInput.on("keypress", (key: KeyEvent) => {
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

      if (key.name === "up" && !key.shift && this.input && this.queuedMessages.length > 0) {
        key.preventDefault();
        key.stopPropagation();

        const dequeued = this.queuedMessages.pop();
        if (!dequeued) {
          return;
        }

        if (dequeued.mode === "steering") {
          this.agent.dequeueLastSteeringMessage();
        } else {
          this.agent.dequeueLastFollowUpMessage();
        }

        this.input.setText(dequeued.content);
        this.input.cursorOffset = this.input.plainText.length;

        this.setStatus(`Dequeued ${dequeued.mode} message for editing.`);
        this.render();
        return;
      }

      if (!this.scrollBox) {
        return;
      }

      if (key.name === "up" && key.shift) {
        key.preventDefault();
        key.stopPropagation();
        this.scrollBox.scrollBy(-3);
        this.renderer?.requestRender();
        return;
      }

      if (key.name === "down" && key.shift) {
        key.preventDefault();
        key.stopPropagation();
        this.scrollBox.scrollBy(3);
        this.renderer?.requestRender();
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

      if (this.isStopped || !this.isStreaming) {
        return;
      }

      this.isStreaming = false;
      this.isAborting = false;
      this.abortController = undefined;
      this.statusStartedAt = undefined;
      this.stopStatusTimer();
      const message = this.formatError(error);
      const entry = this.createMessageEntry({ role: "error", content: message });
      this.messages.push(entry);
      this.setStatus(`Error: ${message}`);
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

    const counts = this.agent.getQueueCounts();
    this.setStatus(
      `Queued ${mode} message. Steering: ${counts.steering}, Follow-up: ${counts.followUp}`
    );
    this.render();
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
    if (queued?.content === content) {
      this.queuedMessages.shift();
      this.render();
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
        const index = this.messages.push(messageEntry) - 1;
        if (entry.role === "assistant") {
          this.currentAssistantIndex = index;
        }
        this.render();
        break;
      }
      case "message_update": {
        if (this.isAborting) {
          break;
        }

        if (this.currentAssistantIndex == null) {
          break;
        }

        const entry = this.messages[this.currentAssistantIndex];
        if (!entry) {
          break;
        }

        if (event.assistantMessageEvent.type === "text_delta") {
          entry.content += event.assistantMessageEvent.delta;
          this.applyMessageContent(entry, entry.content);
          this.render();
        }
        break;
      }
      case "message_end": {
        if (this.isToolMessage(event.message)) {
          break;
        }

        const incoming = this.formatMessage(event.message);
        if (incoming.role === "assistant" && this.currentAssistantIndex != null) {
          const assistant = this.messages[this.currentAssistantIndex];
          if (assistant) {
            if (incoming.content.trim().length === 0) {
              const removeIndex = this.currentAssistantIndex;
              const removed = this.messages.splice(removeIndex, 1)[0];
              if (removed?.container) {
                this.scrollBox?.remove(removed.container.id);
              }
              this.reindexAfterRemoval(removeIndex, 1);
            } else {
              assistant.role = incoming.role;
              this.applyMessageContent(assistant, incoming.content);
            }
          }
          this.currentAssistantIndex = undefined;
          this.render();
          break;
        }

        const existing = this.messages[this.messages.length - 1];
        if (!existing) {
          this.messages.push(this.createMessageEntry(incoming));
        } else {
          existing.role = incoming.role;
          this.applyMessageContent(existing, incoming.content);
        }
        this.render();
        break;
      }
      case "tool_execution_start": {
        if (this.subagentToolCallIds.has(event.toolCallId)) {
          break;
        }
        this.onToolStart(event.toolCallId, event.toolName, event.args);
        break;
      }
      case "tool_execution_update": {
        if (this.subagentToolCallIds.has(event.toolCallId)) {
          break;
        }

        const existing = this.toolCallEntries.get(event.toolCallId);
        if (!existing) {
          break;
        }

        const previewLines = getToolResultLines(this.extractToolOutput(event.partialResult), 1);
        if (previewLines.length === 0) {
          break;
        }

        const preview = `${this.buildToolHeader(existing.toolName, existing.args)}\n  ⎿  ${truncate(
          previewLines[0] ?? "",
          80
        )}`;

        const entry = this.messages[existing.index];
        if (!entry) {
          break;
        }

        this.applyMessageContent(entry, preview);
        this.render();
        break;
      }
      case "tool_execution_end": {
        if (this.subagentToolCallIds.has(event.toolCallId)) {
          break;
        }
        this.onToolEnd(event.toolCallId, event.toolName, event.result, event.isError);
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
            if (entry) {
              entry.role = role;
              this.applyMessageContent(entry, "");
              index = existingTool.index;
            } else {
              const messageEntry = this.createMessageEntry({ role, content: "" });
              index = this.messages.push(messageEntry) - 1;
            }
            this.toolCallEntries.delete(event.toolCallId);
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
          const role = `subagent:${event.subagentId}`;
          const existing = this.subagentEntries.get(event.toolCallId);
          if (!existing) {
            const messageEntry = this.createMessageEntry({ role, content: event.delta });
            const index = this.messages.push(messageEntry) - 1;
            this.subagentEntries.set(event.toolCallId, { index, subagentId: event.subagentId });
            this.render();
            break;
          }

          const entry = this.messages[existing.index];
          if (!entry) {
            break;
          }

          entry.role = role;
          this.applyMessageContent(entry, event.delta);
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
          if (entry) {
            entry.role = role;
            this.applyMessageContent(entry, output);
          }
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

        this.isAborting = false;
        this.abortController = undefined;
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

  private onToolStart(toolCallId: string, toolName: string, args: unknown): void {
    const content = this.buildToolHeader(toolName, args);
    const messageEntry = this.createMessageEntry({ role: "tool", content });
    const index = this.messages.push(messageEntry) - 1;

    this.toolCallEntries.set(toolCallId, {
      index,
      toolName,
      args,
    });

    this.setStatus(this.formatToolStatus(toolName, args, "running"));
    this.render();
  }

  private onToolEnd(toolCallId: string, toolName: string, result: unknown, isError: boolean): void {
    const existing = this.toolCallEntries.get(toolCallId);
    this.toolCallEntries.delete(toolCallId);

    const args = existing?.args;
    const output = this.extractToolOutput(result);
    const content = this.buildToolContent({
      toolName,
      status: isError ? "error" : "done",
      args,
      output,
    });

    if (existing) {
      const entry = this.messages[existing.index];
      if (entry) {
        this.applyMessageContent(entry, content);
      } else {
        this.messages.push(this.createMessageEntry({ role: "tool", content }));
      }
    } else {
      this.messages.push(this.createMessageEntry({ role: "tool", content }));
    }

    if (isError) {
      this.setStatus(this.formatToolStatus(toolName, args, "error"));
    } else if (this.isStreaming) {
      this.setStatus("Working");
    } else {
      this.setStatus("Ready");
    }

    this.render();
  }

  private buildToolHeader(toolName: string, args: unknown): string {
    const displayName = getToolDisplayName(toolName);
    const argSummary = summarizeToolArgs(toolName, args);
    const argText = argSummary ? ` (${argSummary})` : "";
    return `● ${displayName}${argText}`;
  }

  private buildToolContent(options: {
    toolName: string;
    status: "running" | "done" | "error";
    args?: unknown;
    output?: unknown;
  }): string {
    const lines: string[] = [this.buildToolHeader(options.toolName, options.args)];

    if (options.status === "running") {
      return lines.join("\n");
    }

    if (options.status === "error") {
      lines.push(`  ⎿  Error: ${summarizeToolResult(options.output)}`);
      return lines.join("\n");
    }

    const resultLines = getToolResultLines(options.output, TOOL_RESULT_MAX_LINES);
    if (resultLines.length === 0) {
      return lines.join("\n");
    }

    resultLines.forEach((line, index) => {
      const prefix = index === 0 ? "  ⎿  " : "     ";
      lines.push(`${prefix}${truncate(line, 80)}`);
    });

    return lines.join("\n");
  }

  private createMessageEntry(message: DisplayMessage): MessageEntry {
    const entry: MessageEntry = {
      id: `message-${this.messageId++}`,
      role: message.role,
      content: message.content,
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

    if (message.role === "assistant") {
      const row = new Box(this.renderer, {
        width: "100%",
        flexDirection: "row",
      });

      const bullet = new TextBlock(this.renderer, {
        width: 2,
        text: t`${fg(colors.accent)("●")}`,
      });

      const markdown = new MarkdownBlock(this.renderer, {
        flexGrow: 1,
        content: "",
        streaming: true,
      });

      row.add(bullet);
      row.add(markdown);
      container.add(row);

      entry.body = markdown;
    } else {
      const body = new TextBlock(this.renderer, {
        text: "",
        width: "100%",
      });
      container.add(body);
      entry.body = body;
    }

    this.scrollBox.add(container);
    entry.container = container;

    this.applyMessageContent(entry, message.content);

    return entry;
  }

  private applyMessageContent(entry: MessageEntry, content: string): void {
    entry.content = content;

    if (!entry.body) {
      return;
    }

    if (entry.role === "assistant" && entry.body instanceof MarkdownBlock) {
      entry.body.setContent(content);
      return;
    }

    if (entry.body instanceof TextBlock) {
      entry.body.setText(this.formatTextBody(entry.role, content));
    }
  }

  private formatTextBody(role: string, content: string): string | StyledText {
    if (role === "user") {
      return t`${fg(colors.accent)("❯")} ${bold(content)}`;
    }

    if (role === "error") {
      return t`${fg(colors.error)(content)}`;
    }

    if (role === "system") {
      return t`${dim(content)}`;
    }

    if (role.startsWith("subagent:")) {
      return t`${dim(`[${role}]`)} ${content}`;
    }

    if (role === "tool") {
      return this.formatToolTextBody(content);
    }

    return content;
  }

  private formatToolTextBody(content: string): StyledText {
    const newlineIndex = content.indexOf("\n");
    if (newlineIndex === -1) {
      return t`${content}`;
    }

    const header = content.slice(0, newlineIndex);
    const detail = content.slice(newlineIndex);
    return t`${header}${dim(detail)}`;
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
      return formatUnknown(content, { nullFallback: "" });
    }

    return formatUnknown(message, { nullFallback: "" });
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

    if (status === "error") {
      return `Error running ${getToolDisplayName(toolName)}`;
    }

    if (toolName === "read" || toolName === "list") {
      return `Exploring ${path ?? "."}`;
    }

    if (toolName === "glob" || toolName === "find") {
      if (pattern && path) {
        return `Searching ${pattern} in ${path}`;
      }
      if (pattern) {
        return `Searching ${pattern}`;
      }
      return `Searching ${path ?? "."}`;
    }

    if (toolName === "grep") {
      if (pattern && path) {
        return `Grep ${pattern} in ${path}`;
      }
      if (pattern) {
        return `Grep ${pattern}`;
      }
      return "Grep";
    }

    if (toolName === "bash") {
      return command ? `Running ${command}` : "Running command";
    }

    if (toolName === "webfetch") {
      return url ? `Fetching ${url}` : "Fetching URL";
    }

    if (toolName === "write" || toolName === "edit" || toolName === "update") {
      return path ? `${getToolDisplayName(toolName)} ${path}` : getToolDisplayName(toolName);
    }

    return "Working";
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
      totalLines -= lineCounts[removeCount] ?? 0;
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
    this.reindexAfterRemoval(0, removeCount);
  }

  private reindexAfterRemoval(startIndex: number, removedCount: number): void {
    if (removedCount <= 0) {
      return;
    }

    const endIndex = startIndex + removedCount;

    if (this.currentAssistantIndex != null) {
      if (this.currentAssistantIndex >= startIndex && this.currentAssistantIndex < endIndex) {
        this.currentAssistantIndex = undefined;
      } else if (this.currentAssistantIndex >= endIndex) {
        this.currentAssistantIndex -= removedCount;
      }
    }

    const updatedTools = new Map<string, ToolCallEntry>();
    for (const [toolCallId, entry] of this.toolCallEntries.entries()) {
      if (entry.index >= startIndex && entry.index < endIndex) {
        continue;
      }
      const nextIndex = entry.index >= endIndex ? entry.index - removedCount : entry.index;
      updatedTools.set(toolCallId, { ...entry, index: nextIndex });
    }
    this.toolCallEntries = updatedTools;

    const updatedSubagents = new Map<string, { index: number; subagentId: string }>();
    for (const [toolCallId, entry] of this.subagentEntries.entries()) {
      if (entry.index >= startIndex && entry.index < endIndex) {
        continue;
      }
      const nextIndex = entry.index >= endIndex ? entry.index - removedCount : entry.index;
      updatedSubagents.set(toolCallId, { ...entry, index: nextIndex });
    }
    this.subagentEntries = updatedSubagents;
  }

  private formatError(error: unknown): string {
    return formatUnknown(error, {
      includeStack: true,
      errorFallback: "Unknown error",
      nullFallback: "Unknown error",
    });
  }

  private buildHeaderContent(): StyledText {
    const version = this.getVersionLabel();
    const model = this.getModelLabel();
    const thinking = this.agent.state.thinkingLevel;
    const thinkingText = thinking && thinking !== "off" ? ` · thinking: ${thinking}` : "";
    const directory = this.formatDirectory(process.cwd());

    return t`${bold("Agentik")} ${dim(`(${version})`)}
${dim(`${model}${thinkingText} · ${directory}`)}
${dim("Enter send · Shift+Enter newline · Alt+Enter queue follow-up · Ctrl+C interrupt/exit · PgUp/PgDn scroll")}`;
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
    const next = this.exitHintActive && text === "Ready" ? TuiApp.exitHintText : text;
    this.statusMessage = next;
    this.updateFooter();
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

  private startStatusTimer(): void {
    if (this.statusTimer) {
      return;
    }

    this.statusTimer = setInterval(() => {
      if (!this.isStreaming) {
        return;
      }
      this.updateFooter();
      this.renderer?.requestRender();
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

  private buildFooterContent(): StyledText {
    const parts: string[] = [];

    if (this.isStreaming && this.statusStartedAt) {
      parts.push(
        `${this.statusMessage} (${this.formatElapsed(Date.now() - this.statusStartedAt)})`
      );
    } else {
      parts.push(this.statusMessage);
    }

    if (this.queuedMessages.length > 0) {
      parts.push(`queued:${this.queuedMessages.length}`);
    }

    parts.push(this.getModelLabel());

    return t`${dim(parts.join(" | "))}`;
  }

  private updateFooter(): void {
    if (!this.footer) {
      return;
    }

    this.footer.setText(this.buildFooterContent());
  }

  private render(): void {
    this.trimHistory();

    if (this.header) {
      this.header.setText(this.buildHeaderContent());
    }

    this.updateFooter();
    this.renderer?.requestRender();
  }
}
