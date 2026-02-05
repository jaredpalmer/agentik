/**
 * OpenTUI-based terminal interface for the agentik coding agent.
 *
 * Layout (vertical flex):
 *   Header  – banner with model info & keybindings
 *   Chat    – scrollable message area (sticky-bottom)
 *   Input   – multi-line textarea with border (color = thinking level)
 *   Footer  – token stats / model / thinking level
 */

import {
  type CliRenderer,
  type KeyEvent,
  type StyledText,
  type TextareaAction,
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  TextareaRenderable,
  MarkdownRenderable,
  SyntaxStyle,
  t,
  bold,
  dim,
  fg,
} from "@opentui/core";
import type {
  Agent,
  AgentEvent,
  AgentMessage,
  AssistantMessageEvent,
  ThinkingLevel,
} from "@agentik/agent";
import { colors, createSyntaxStyle, getThinkingBorderColor } from "./theme.js";

// ============================================================================
// Types
// ============================================================================

interface TuiOptions {
  agent: Agent;
  provider: string;
  modelId: string;
  toolNames: string[];
}

interface MessageBlock {
  type: "user" | "assistant" | "tool" | "thinking" | "status";
  container: BoxRenderable;
  markdown?: MarkdownRenderable;
  text?: TextRenderable;
}

interface PendingTool {
  block: MessageBlock;
  toolName: string;
  startTime: number;
}

// ============================================================================
// Helpers
// ============================================================================

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function summarizeToolArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;

  switch (toolName) {
    case "bash":
      return typeof a.command === "string" ? truncate(a.command, 60) : "";
    case "read_file":
      return typeof a.file_path === "string" ? a.file_path : "";
    case "write_file":
      return typeof a.file_path === "string" ? a.file_path : "";
    case "edit": {
      const path = typeof a.file_path === "string" ? a.file_path : "";
      const old = typeof a.old_string === "string" ? truncate(a.old_string, 30) : "";
      return old ? `${path} "${old}"` : path;
    }
    case "glob":
      return typeof a.pattern === "string" ? a.pattern : "";
    case "grep": {
      const pattern = typeof a.pattern === "string" ? a.pattern : "";
      const path = typeof a.path === "string" ? ` in ${a.path}` : "";
      return `${pattern}${path}`;
    }
    case "ls":
      return typeof a.path === "string" ? a.path : ".";
    default:
      return "";
  }
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\n/g, "\\n");
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "\u2026" : oneLine;
}

interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  details?: Record<string, unknown>;
}

function getToolResultText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as ToolResult;
  if (!r.content) return "";
  return r.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n");
}

function getToolDiff(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as ToolResult;
  if (r.details && typeof r.details.diff === "string") return r.details.diff;
  return null;
}

function summarizeToolResult(result: unknown, isError: boolean): string {
  const text = getToolResultText(result);
  if (isError && text) return truncate(text, 80);
  if (text) {
    const lines = text.split("\n");
    if (lines.length <= 3) return truncate(text, 120);
    return `${lines.length} lines`;
  }
  return "";
}

// ============================================================================
// TUI Application
// ============================================================================

export class TuiApp {
  private renderer!: CliRenderer;
  private agent: Agent;
  private provider: string;
  private modelId: string;
  private toolNames: string[];
  private syntaxStyle!: SyntaxStyle;

  // Layout components
  private root!: BoxRenderable;
  private header!: TextRenderable;
  private chatScroll!: ScrollBoxRenderable;
  private inputBox!: BoxRenderable;
  private textarea!: TextareaRenderable;
  private footer!: TextRenderable;

  // State
  private messages: MessageBlock[] = [];
  private pendingTools = new Map<string, PendingTool>();
  private currentAssistant: MessageBlock | null = null;
  private currentThinking: MessageBlock | null = null;
  private currentThinkingText = "";
  private hideThinking = false;
  private totalTokensIn = 0;
  private totalTokensOut = 0;
  private totalCacheRead = 0;
  private totalCacheWrite = 0;
  private lastSigint = 0;
  private unsubscribe?: () => void;

  constructor(opts: TuiOptions) {
    this.agent = opts.agent;
    this.provider = opts.provider;
    this.modelId = opts.modelId;
    this.toolNames = opts.toolNames;
  }

  async start(): Promise<void> {
    this.syntaxStyle = createSyntaxStyle();

    this.renderer = await createCliRenderer({
      exitOnCtrlC: false,
      useAlternateScreen: true,
      useMouse: false,
      autoFocus: true,
    });

    this.buildLayout();
    this.wireAgentEvents();
    this.wireInput();
    this.updateFooter();
  }

  // ==========================================================================
  // Layout
  // ==========================================================================

  private buildLayout(): void {
    const r = this.renderer;
    const thinkingLevel = this.agent.state.thinkingLevel;

    this.root = new BoxRenderable(r, {
      id: "root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: colors.bg,
    });

    this.header = new TextRenderable(r, {
      id: "header",
      width: "100%",
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
      content: this.buildHeaderContent(),
    });

    this.chatScroll = new ScrollBoxRenderable(r, {
      id: "chat",
      width: "100%",
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: "bottom",
      contentOptions: {
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
      },
    });

    this.inputBox = new BoxRenderable(r, {
      id: "input-box",
      width: "100%",
      height: 4,
      border: true,
      borderStyle: "rounded",
      borderColor: getThinkingBorderColor(thinkingLevel),
      focusedBorderColor: getThinkingBorderColor(thinkingLevel),
      paddingLeft: 1,
      paddingRight: 1,
    });

    this.textarea = new TextareaRenderable(r, {
      id: "input",
      width: "100%",
      height: "100%",
      placeholder: "Type a message...",
      placeholderColor: colors.dimFg,
      backgroundColor: colors.bg,
      focusedBackgroundColor: colors.bg,
      textColor: colors.fg,
      focusedTextColor: colors.fg,
      cursorColor: colors.fg,
      wrapMode: "word",
      keyBindings: [
        { name: "return", action: "submit" satisfies TextareaAction },
        { name: "return", shift: true, action: "newline" satisfies TextareaAction },
      ],
    });

    this.inputBox.add(this.textarea);

    this.footer = new TextRenderable(r, {
      id: "footer",
      width: "100%",
      paddingLeft: 1,
      paddingRight: 1,
      content: t`${dim("Ready")}`,
    });

    this.root.add(this.header);
    this.root.add(this.chatScroll);
    this.root.add(this.inputBox);
    this.root.add(this.footer);
    r.root.add(this.root);

    this.textarea.focus();
  }

  private buildHeaderContent(): StyledText {
    const thinkingLevel = this.agent.state.thinkingLevel;
    const thinkingStr = thinkingLevel !== "off" ? ` | thinking: ${thinkingLevel}` : "";
    return t`${bold(fg(colors.cyan)("agentik"))} ${dim("coding agent")}
${dim(`${this.provider}/${this.modelId}${thinkingStr}`)}
${dim("Enter send | Shift+Enter newline | Ctrl+C cancel/exit | Ctrl+T thinking | /help commands")}`;
  }

  private updateInputBorderColor(): void {
    const level = this.agent.state.thinkingLevel;
    const color = getThinkingBorderColor(level);
    this.inputBox.borderColor = color;
    this.inputBox.focusedBorderColor = color;
  }

  // ==========================================================================
  // Agent event wiring
  // ==========================================================================

  private wireAgentEvents(): void {
    this.unsubscribe = this.agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case "agent_start":
          this.onAgentStart();
          break;
        case "message_update":
          this.onMessageUpdate(event.assistantMessageEvent);
          break;
        case "message_end":
          this.onMessageEnd(event.message);
          break;
        case "tool_execution_start":
          this.onToolStart(event.toolCallId, event.toolName, event.args);
          break;
        case "tool_execution_end":
          this.onToolEnd(event.toolCallId, event.toolName, event.result, event.isError);
          break;
        case "turn_end":
          this.onTurnEnd(event.message);
          break;
        case "agent_end":
          this.onAgentEnd();
          break;
      }
    });
  }

  private onAgentStart(): void {
    this.updateFooter("Working...");
  }

  private onMessageUpdate(ame: AssistantMessageEvent): void {
    switch (ame.type) {
      case "start":
        this.currentAssistant = this.addMessageBlock("assistant");
        this.currentThinking = null;
        break;

      case "text_delta":
        if (this.currentAssistant?.markdown) {
          this.currentAssistant.markdown.content += ame.delta;
        }
        break;

      case "thinking_start":
        if (!this.hideThinking) {
          this.currentThinking = this.addMessageBlock("thinking");
        }
        this.currentThinkingText = "";
        break;

      case "thinking_delta":
        this.currentThinkingText += ame.delta;
        if (this.currentThinking?.text) {
          this.currentThinking.text.content = t`${dim(this.currentThinkingText)}`;
        }
        break;

      case "thinking_end":
        this.currentThinking = null;
        this.currentThinkingText = "";
        break;

      case "toolcall_start":
        break;

      case "done":
      case "error":
        break;
    }
  }

  private onMessageEnd(_message: AgentMessage): void {
    this.currentAssistant = null;
    this.currentThinking = null;
  }

  private onToolStart(toolCallId: string, toolName: string, args: unknown): void {
    const summary = summarizeToolArgs(toolName, args);
    const argText = summary ? ` ${summary}` : "";
    const block = this.addMessageBlock("tool");
    if (block.text) {
      block.text.content = t`${fg(colors.toolLabel)(dim(`  \u29D7 ${toolName}`))}${dim(argText)}`;
    }
    this.pendingTools.set(toolCallId, { block, toolName, startTime: Date.now() });
  }

  private onToolEnd(toolCallId: string, toolName: string, result: unknown, isError: boolean): void {
    const pending = this.pendingTools.get(toolCallId);
    const elapsed = pending ? Date.now() - pending.startTime : 0;
    const timeStr = elapsed > 500 ? ` ${(elapsed / 1000).toFixed(1)}s` : "";
    this.pendingTools.delete(toolCallId);

    const icon = isError ? "\u2717" : "\u2713";
    const statusColor = isError ? colors.errorFg : colors.successFg;
    const resultSummary = summarizeToolResult(result, isError);
    const resultText = resultSummary ? ` ${resultSummary}` : "";

    // Update the pending tool block in-place
    if (pending?.block.text) {
      pending.block.text.content = t`${fg(statusColor)(dim(`  ${icon} ${toolName}${timeStr}`))}${dim(resultText)}`;
    } else {
      const block = this.addMessageBlock("status");
      if (block.text) {
        block.text.content = t`${fg(statusColor)(dim(`  ${icon} ${toolName}${timeStr}`))}`;
      }
    }

    // Show diff for edit tool results
    if (!isError && toolName === "edit") {
      const diff = getToolDiff(result);
      if (diff) {
        this.addDiffBlock(diff);
      }
    }
  }

  private addDiffBlock(diff: string): void {
    const r = this.renderer;
    const container = new BoxRenderable(r, {
      width: "100%",
      flexDirection: "column",
      paddingLeft: 2,
    });

    for (const line of diff.split("\n")) {
      let content: StyledText;
      if (line.startsWith("+")) {
        content = t`${fg(colors.diffAdded)(line)}`;
      } else if (line.startsWith("-")) {
        content = t`${fg(colors.diffRemoved)(line)}`;
      } else {
        content = t`${fg(colors.diffContext)(line)}`;
      }
      container.add(new TextRenderable(r, { width: "100%", content }));
    }

    this.messages.push({ type: "status", container });
    this.chatScroll.add(container);
  }

  private onTurnEnd(message: AgentMessage): void {
    if (message.role === "assistant") {
      this.totalTokensIn += message.usage.input;
      this.totalTokensOut += message.usage.output;
      this.totalCacheRead += message.usage.cacheRead;
      this.totalCacheWrite += message.usage.cacheWrite;

      if (message.stopReason === "aborted") {
        this.addStatusMessage(t`${dim("[interrupted]")}`);
      }
    }
    this.updateFooter();
  }

  private onAgentEnd(): void {
    this.updateFooter();
    this.textarea.focus();
  }

  // ==========================================================================
  // Input handling
  // ==========================================================================

  private wireInput(): void {
    this.textarea.onSubmit = () => {
      const text = this.textarea.plainText.trim();
      if (!text) return;

      // Handle slash commands
      if (text.startsWith("/")) {
        if (this.handleSlashCommand(text)) {
          this.textarea.initialValue = "";
          return;
        }
      }

      this.addUserMessage(text);
      this.textarea.initialValue = "";

      this.agent.prompt(text).catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.addErrorMessage(errMsg);
        this.updateFooter();
        this.textarea.focus();
      });
    };

    this.renderer.keyInput.on("keypress", (key: KeyEvent) => {
      // Ctrl+C: cancel/exit
      if (key.name === "c" && key.ctrl) {
        this.handleCtrlC();
        return;
      }

      // Ctrl+T: cycle thinking level
      if (key.name === "t" && key.ctrl) {
        this.cycleThinkingLevel();
        return;
      }
    });
  }

  private handleCtrlC(): void {
    const now = Date.now();

    if (this.agent.state.isStreaming) {
      this.agent.abort();
      this.addStatusMessage(t`${dim("[cancelled]")}`);
      this.lastSigint = now;
      return;
    }

    if (now - this.lastSigint < 2000) {
      this.destroy();
      process.exit(0);
    }

    this.lastSigint = now;
    this.addStatusMessage(t`${dim("Press Ctrl+C again to exit")}`);
  }

  // ==========================================================================
  // Slash commands
  // ==========================================================================

  private handleSlashCommand(text: string): boolean {
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ");

    switch (cmd) {
      case "/quit":
      case "/exit":
        this.destroy();
        process.exit(0);
        return true; // unreachable, prevents fall-through if exit is stubbed

      case "/clear":
        this.agent.clearMessages();
        this.clearChat();
        this.addStatusMessage(t`${dim("Conversation cleared.")}`);
        this.textarea.focus();
        return true;

      case "/reset":
        this.agent.reset();
        this.clearChat();
        this.addStatusMessage(t`${dim("Agent reset.")}`);
        this.textarea.focus();
        return true;

      case "/thinking": {
        if (arg && (THINKING_LEVELS as readonly string[]).includes(arg)) {
          this.agent.setThinkingLevel(arg as ThinkingLevel);
          this.updateInputBorderColor();
          this.header.content = this.buildHeaderContent();
          this.addStatusMessage(t`${dim(`Thinking level: ${arg}`)}`);
          this.updateFooter();
        } else {
          const current = this.agent.state.thinkingLevel;
          this.addStatusMessage(
            t`${dim(`Thinking: ${current}. Options: ${THINKING_LEVELS.join(", ")}`)}`
          );
        }
        this.textarea.focus();
        return true;
      }

      case "/toggleThinking":
        this.hideThinking = !this.hideThinking;
        this.addStatusMessage(
          t`${dim(`Thinking blocks: ${this.hideThinking ? "hidden" : "visible"}`)}`
        );
        this.textarea.focus();
        return true;

      case "/help":
        this.showHelp();
        this.textarea.focus();
        return true;

      case "/session":
        this.showSessionInfo();
        this.textarea.focus();
        return true;

      default:
        return false;
    }
  }

  private showHelp(): void {
    const helpLines = [
      "Commands:",
      "  /help            Show this help",
      "  /clear           Clear conversation",
      "  /reset           Reset agent state",
      "  /thinking [lvl]  Set thinking level (off/minimal/low/medium/high/xhigh)",
      "  /toggleThinking  Hide/show thinking blocks",
      "  /session         Show session info",
      "  /quit /exit      Exit",
      "",
      "Keybindings:",
      "  Enter            Send message",
      "  Shift+Enter      New line",
      "  Ctrl+C           Cancel stream / double to exit",
      "  Ctrl+T           Cycle thinking level",
    ];
    this.addStatusMessage(t`${dim(helpLines.join("\n"))}`);
  }

  private showSessionInfo(): void {
    const state = this.agent.state;
    const lines = [
      `Model: ${this.provider}/${this.modelId}`,
      `Thinking: ${state.thinkingLevel}`,
      `Messages: ${state.messages.length}`,
      `Tokens: ${formatTokenCount(this.totalTokensIn)} in / ${formatTokenCount(this.totalTokensOut)} out`,
      `Cache: ${formatTokenCount(this.totalCacheRead)} read / ${formatTokenCount(this.totalCacheWrite)} write`,
      `Tools: ${this.toolNames.join(", ")}`,
    ];
    this.addStatusMessage(t`${dim(lines.join("\n"))}`);
  }

  // ==========================================================================
  // Thinking level
  // ==========================================================================

  private cycleThinkingLevel(): void {
    const current = this.agent.state.thinkingLevel;
    const idx = THINKING_LEVELS.indexOf(current);
    const next = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
    this.agent.setThinkingLevel(next);
    this.updateInputBorderColor();
    this.header.content = this.buildHeaderContent();
    this.addStatusMessage(t`${dim(`Thinking level: ${next}`)}`);
    this.updateFooter();
  }

  // ==========================================================================
  // Message rendering
  // ==========================================================================

  private addMessageBlock(type: MessageBlock["type"]): MessageBlock {
    const r = this.renderer;

    const container = new BoxRenderable(r, {
      width: "100%",
      flexDirection: "column",
      paddingTop: type === "status" || type === "tool" ? 0 : 1,
    });

    const block: MessageBlock = { type, container };

    if (type === "assistant") {
      const label = new TextRenderable(r, {
        width: "100%",
        content: t`${bold(fg(colors.assistantLabel)("Assistant"))}`,
      });
      container.add(label);

      const md = new MarkdownRenderable(r, {
        width: "100%",
        syntaxStyle: this.syntaxStyle,
        streaming: true,
        conceal: true,
        content: "",
      });
      container.add(md);
      block.markdown = md;
    } else if (type === "thinking") {
      const txt = new TextRenderable(r, {
        width: "100%",
        content: t`${dim("")}`,
      });
      container.add(txt);
      block.text = txt;
    } else {
      const txt = new TextRenderable(r, { width: "100%" });
      container.add(txt);
      block.text = txt;
    }

    this.messages.push(block);
    this.chatScroll.add(container);
    return block;
  }

  private addUserMessage(text: string): void {
    const r = this.renderer;
    const container = new BoxRenderable(r, {
      width: "100%",
      flexDirection: "column",
      paddingTop: 1,
    });

    const label = new TextRenderable(r, {
      width: "100%",
      content: t`${bold(fg(colors.userLabel)("You"))}`,
    });
    container.add(label);

    const body = new TextRenderable(r, {
      width: "100%",
      content: text,
    });
    container.add(body);

    this.messages.push({ type: "user", container });
    this.chatScroll.add(container);
  }

  private addStatusMessage(content: StyledText | string): void {
    const r = this.renderer;
    const container = new BoxRenderable(r, { width: "100%" });
    const txt = new TextRenderable(r, {
      width: "100%",
      content,
    });
    container.add(txt);

    this.messages.push({ type: "status", container, text: txt });
    this.chatScroll.add(container);
  }

  private addErrorMessage(text: string): void {
    const r = this.renderer;
    const container = new BoxRenderable(r, { width: "100%" });
    const txt = new TextRenderable(r, {
      width: "100%",
      content: t`${fg(colors.errorFg)(`Error: ${text}`)}`,
    });
    container.add(txt);

    this.messages.push({ type: "status", container, text: txt });
    this.chatScroll.add(container);
  }

  private clearChat(): void {
    for (const msg of this.messages) {
      this.chatScroll.remove(msg.container.id);
    }
    this.messages = [];
    this.pendingTools.clear();
    this.totalTokensIn = 0;
    this.totalTokensOut = 0;
    this.totalCacheRead = 0;
    this.totalCacheWrite = 0;
  }

  // ==========================================================================
  // Footer
  // ==========================================================================

  private updateFooter(status?: string): void {
    const streaming = this.agent.state.isStreaming;
    const thinkingLevel = this.agent.state.thinkingLevel;
    const statusText = status ?? (streaming ? "Working..." : "Ready");

    const parts: string[] = [statusText];

    if (this.totalTokensIn > 0) {
      let tokenStr = `\u2191${formatTokenCount(this.totalTokensIn)} \u2193${formatTokenCount(this.totalTokensOut)}`;
      if (this.totalCacheRead > 0 || this.totalCacheWrite > 0) {
        tokenStr += ` R${formatTokenCount(this.totalCacheRead)} W${formatTokenCount(this.totalCacheWrite)}`;
      }
      parts.push(tokenStr);
    }

    if (thinkingLevel !== "off") {
      parts.push(`thinking:${thinkingLevel}`);
    }

    parts.push(`${this.provider}/${this.modelId}`);

    this.footer.content = t`${dim(parts.join(" | "))}`;
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  destroy(): void {
    this.unsubscribe?.();
    this.syntaxStyle?.destroy();
    this.renderer?.destroy();
  }
}
