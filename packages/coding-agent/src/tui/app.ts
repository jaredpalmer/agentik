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
import { exportSessionToHtml } from "../session/export-html.js";
import type { SessionStore } from "../session/store.js";
import { colors, createSyntaxStyle, getThinkingBorderColor } from "./theme.js";

interface TuiOptions {
  agent: Agent;
  provider: string;
  modelId: string;
  toolNames: string[];
  sessionStore: SessionStore;
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
  args: unknown;
  startTime: number;
}

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  bash: "Bash",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  ls: "LS",
};

function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}

function summarizeToolArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;

  switch (toolName) {
    case "bash":
      return typeof a.command === "string" ? truncate(a.command, 60) : "";
    case "read_file":
    case "write_file":
      return typeof a.path === "string" ? a.path : "";
    case "edit":
      return typeof a.path === "string" ? a.path : "";
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

interface ToolParameterSchema {
  properties?: Record<string, unknown>;
  required?: string[];
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
  const v = value as { type?: unknown };

  if (typeof v.type === "string") return v.type;
  if (Array.isArray(v.type) && v.type.length > 0) {
    const parts = v.type.filter((t): t is string => typeof t === "string");
    if (parts.length > 0) return parts.join("|");
  }

  return "any";
}

function summarizeToolParameters(parameters: unknown): string {
  const schema = toToolParameterSchema(parameters);
  if (!schema || !schema.properties || Object.keys(schema.properties).length === 0) {
    return "(no parameters)";
  }

  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const parts = Object.entries(schema.properties).map(([name, value]) => {
    const optionalMark = required.has(name) ? "" : "?";
    const type = getParameterType(value);
    return `${name}${optionalMark}:${type}`;
  });

  return `{ ${parts.join(", ")} }`;
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

function getToolResultLines(result: unknown, maxLines: number): string[] {
  const text = getToolResultText(result);
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`];
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

export class TuiApp {
  private renderer!: CliRenderer;
  private agent: Agent;
  private provider: string;
  private modelId: string;
  private toolNames: string[];
  private sessionStore: SessionStore;
  private syntaxStyle!: SyntaxStyle;
  private root!: BoxRenderable;
  private header!: TextRenderable;
  private chatScroll!: ScrollBoxRenderable;
  private inputBox!: BoxRenderable;
  private textarea!: TextareaRenderable;
  private footer!: TextRenderable;
  private messages: MessageBlock[] = [];
  private pendingTools = new Map<string, PendingTool>();
  private currentAssistant: MessageBlock | null = null;
  private currentThinking: MessageBlock | null = null;
  private currentThinkingText = "";
  private hideThinking = true;
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
    this.sessionStore = opts.sessionStore;
  }

  async start(): Promise<void> {
    this.syntaxStyle = createSyntaxStyle();

    this.renderer = await createCliRenderer({
      exitOnCtrlC: false,
      useAlternateScreen: true,
      useMouse: true,
      autoFocus: true,
    });

    this.buildLayout();
    this.wireAgentEvents();
    this.wireInput();
    this.updateFooter();
  }

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
    const thinkingStr = thinkingLevel !== "off" ? ` \u00b7 thinking: ${thinkingLevel}` : "";
    const cwd = process.cwd().replace(process.env.HOME ?? "", "~");
    return t`${bold(fg(colors.cyan)("agentik"))} ${dim("v0.1.0")}
${dim(`${this.provider}/${this.modelId}${thinkingStr} \u00b7 ${cwd}`)}
${dim("Enter send \u00b7 Ctrl+C cancel \u00b7 Ctrl+T thinking \u00b7 PgUp/PgDn scroll \u00b7 /help")}`;
  }

  private updateInputBorderColor(): void {
    const level = this.agent.state.thinkingLevel;
    const color = getThinkingBorderColor(level);
    this.inputBox.borderColor = color;
    this.inputBox.focusedBorderColor = color;
  }

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
      case "text_start":
        if (!this.currentAssistant) {
          this.currentAssistant = this.addMessageBlock("assistant");
          this.currentThinking = null;
        }
        break;

      case "text_delta":
        if (!this.currentAssistant) {
          this.currentAssistant = this.addMessageBlock("assistant");
        }
        if (this.currentAssistant.markdown) {
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
    }
  }

  private onMessageEnd(message: AgentMessage): void {
    this.sessionStore.appendMessage(message);
    this.currentAssistant = null;
    this.currentThinking = null;
  }

  private onToolStart(toolCallId: string, toolName: string, args: unknown): void {
    const displayName = getToolDisplayName(toolName);
    const summary = summarizeToolArgs(toolName, args);
    const argText = summary ? dim(`(${summary})`) : "";
    const block = this.addMessageBlock("tool");
    if (block.text) {
      block.text.content = t`${fg(colors.toolIcon)("\u25CF")} ${bold(displayName)}${argText}`;
    }
    this.pendingTools.set(toolCallId, { block, toolName, args, startTime: Date.now() });
  }

  private onToolEnd(toolCallId: string, toolName: string, result: unknown, isError: boolean): void {
    const r = this.renderer;
    const pending = this.pendingTools.get(toolCallId);
    this.pendingTools.delete(toolCallId);

    const displayName = getToolDisplayName(toolName);
    const bulletColor = isError ? colors.errorFg : colors.toolIcon;

    if (pending?.block.text) {
      // Update the main tool line with final bullet color + args
      const argSummary = summarizeToolArgs(toolName, pending.args);
      const argText = argSummary ? dim(`(${argSummary})`) : "";
      pending.block.text.content = t`${fg(bulletColor)("\u25CF")} ${bold(displayName)}${argText}`;

      // Add result lines below with ⎿ connector
      if (isError) {
        const errorText = summarizeToolResult(result, true);
        const resultLine = new TextRenderable(r, {
          width: "100%",
          content: t`  ${dim("\u23BF")}  ${fg(colors.errorFg)(`Error: ${errorText}`)}`,
        });
        pending.block.container.add(resultLine);
      } else {
        const lines = getToolResultLines(result, 4);
        for (let i = 0; i < lines.length; i++) {
          const lineText = truncate(lines[i], 80);
          const content =
            i === 0 ? t`  ${dim("\u23BF")}  ${dim(lineText)}` : t`     ${dim(lineText)}`;
          const resultLine = new TextRenderable(r, {
            width: "100%",
            content,
          });
          pending.block.container.add(resultLine);
        }
      }
    } else {
      const block = this.addMessageBlock("status");
      if (block.text) {
        block.text.content = t`${fg(bulletColor)("\u25CF")} ${bold(displayName)}`;
      }
    }

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
      paddingLeft: 4,
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
    const error = this.agent.state.error;
    if (error) {
      this.addErrorMessage(error);
    }
    this.updateFooter();
    this.textarea.focus();
  }

  private wireInput(): void {
    this.textarea.onSubmit = () => {
      const text = this.textarea.plainText.trim();
      if (!text) return;

      if (text.startsWith("/")) {
        if (this.handleSlashCommand(text)) {
          this.textarea.setText("");
          return;
        }
      }

      this.addUserMessage(text);
      this.textarea.setText("");

      this.agent.prompt(text).catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.addErrorMessage(errMsg);
        this.updateFooter();
        this.textarea.focus();
      });
    };

    this.renderer.keyInput.on("keypress", (key: KeyEvent) => {
      if (key.name === "c" && key.ctrl) {
        this.handleCtrlC();
        return;
      }

      if (key.name === "t" && key.ctrl) {
        this.cycleThinkingLevel();
        return;
      }

      if (key.name === "pageup") {
        this.chatScroll.scrollBy(-10);
        return;
      }
      if (key.name === "pagedown") {
        this.chatScroll.scrollBy(10);
        return;
      }
      if (key.name === "up" && key.shift) {
        this.chatScroll.scrollBy(-3);
        return;
      }
      if (key.name === "down" && key.shift) {
        this.chatScroll.scrollBy(3);
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
        this.sessionStore.startNewSession();
        this.addStatusMessage(t`${dim("Conversation cleared. Started a new session file.")}`);
        this.textarea.focus();
        return true;

      case "/reset":
        this.agent.reset();
        this.clearChat();
        this.sessionStore.startNewSession();
        this.addStatusMessage(t`${dim("Agent reset. Started a new session file.")}`);
        this.textarea.focus();
        return true;

      case "/thinking": {
        if (arg && (THINKING_LEVELS as readonly string[]).includes(arg)) {
          this.applyThinkingLevel(arg as ThinkingLevel);
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

      case "/export":
        void this.handleExportCommand(arg);
        this.textarea.focus();
        return true;

      case "/tools":
        this.showToolsInfo();
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
      "  /export [file]   Export current session to HTML",
      "  /tools           Show active tools and parameter schemas",
      "  /quit /exit      Exit",
      "",
      "Keybindings:",
      "  Enter            Send message",
      "  Shift+Enter      New line",
      "  Ctrl+C           Cancel stream / double to exit",
      "  Ctrl+T           Cycle thinking level",
      "  PgUp/PgDn        Scroll chat history",
      "  Shift+Up/Down    Scroll chat (small step)",
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
      `Session file: ${this.sessionStore.getSessionFile()}`,
      `Persisted entries: ${this.sessionStore.getPersistedMessageCount()}`,
    ];
    this.addStatusMessage(t`${dim(lines.join("\n"))}`);
  }

  private async handleExportCommand(outputArg: string): Promise<void> {
    try {
      const outputPath = outputArg.trim().length > 0 ? outputArg.trim() : undefined;
      const exported = exportSessionToHtml(this.sessionStore.getSessionFile(), {
        outputPath,
        systemPrompt: this.agent.state.systemPrompt,
        tools: this.agent.getAllTools(),
      });
      this.addStatusMessage(t`${dim(`Exported session HTML: ${exported}`)}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.addErrorMessage(`Failed to export session: ${message}`);
    }
  }

  private showToolsInfo(): void {
    const allTools = this.agent.getAllTools();
    if (allTools.length === 0) {
      this.addStatusMessage(t`${dim("No tools configured.")}`);
      return;
    }

    const activeTools = new Set(this.agent.getActiveTools());
    const lines = ["Tools:"];

    for (const tool of allTools) {
      const status = activeTools.has(tool.name) ? "active" : "inactive";
      lines.push(`  ${tool.name} [${status}] - ${tool.description}`);
      lines.push(`    params: ${summarizeToolParameters(tool.parameters)}`);
    }

    this.addStatusMessage(t`${dim(lines.join("\n"))}`);
  }

  private applyThinkingLevel(level: ThinkingLevel): void {
    this.agent.setThinkingLevel(level);
    this.updateInputBorderColor();
    this.header.content = this.buildHeaderContent();
    this.addStatusMessage(t`${dim(`Thinking level: ${level}`)}`);
    this.updateFooter();
  }

  private cycleThinkingLevel(): void {
    const current = this.agent.state.thinkingLevel;
    const idx = THINKING_LEVELS.indexOf(current);
    const next = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
    this.applyThinkingLevel(next);
  }

  private addMessageBlock(type: MessageBlock["type"]): MessageBlock {
    const r = this.renderer;

    const container = new BoxRenderable(r, {
      width: "100%",
      flexDirection: "column",
      paddingTop: type === "status" ? 0 : 1,
    });

    const block: MessageBlock = { type, container };

    if (type === "assistant") {
      const row = new BoxRenderable(r, {
        width: "100%",
        flexDirection: "row",
      });
      const bullet = new TextRenderable(r, {
        width: 2,
        content: t`${fg(colors.toolIcon)("\u25CF")}`,
      });
      row.add(bullet);
      const md = new MarkdownRenderable(r, {
        flexGrow: 1,
        syntaxStyle: this.syntaxStyle,
        streaming: true,
        conceal: true,
        content: "",
      });
      row.add(md);
      container.add(row);
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

    const body = new TextRenderable(r, {
      width: "100%",
      content: t`${fg(colors.userPrompt)("\u276F")} ${bold(text)}`,
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
    this.addStatusMessage(t`${fg(colors.errorFg)(`Error: ${text}`)}`);
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

  destroy(): void {
    this.unsubscribe?.();
    this.syntaxStyle?.destroy();
    this.renderer?.destroy();
  }
}
