/**
 * OpenTUI-based terminal interface for the agentik coding agent.
 *
 * Layout (vertical flex):
 *   Header  – banner with model info
 *   Chat    – scrollable message area (sticky-bottom)
 *   Input   – multi-line textarea with border
 *   Footer  – token stats / status
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
import type { Agent, AgentEvent, AssistantMessage, AssistantMessageEvent } from "@agentik/agent";
import { colors, createSyntaxStyle } from "./theme.js";

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
  private currentAssistant: MessageBlock | null = null;
  private currentThinking: MessageBlock | null = null;
  private totalTokensIn = 0;
  private totalTokensOut = 0;
  private lastSigint = 0;

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

    // Root container – full-screen vertical flex
    this.root = new BoxRenderable(r, {
      id: "root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: colors.bg,
    });

    // Header
    this.header = new TextRenderable(r, {
      id: "header",
      width: "100%",
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
      content: t`${bold(fg(colors.cyan)("agentik"))} ${dim("coding agent")}
${dim(`Model: ${this.provider}/${this.modelId}`)}
${dim(`Tools: ${this.toolNames.join(", ")}`)}
${dim("Enter to send, Shift+Enter for newline, Ctrl+C to cancel/exit")}`,
    });

    // Chat area – scrollable, sticks to bottom
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

    // Input area
    this.inputBox = new BoxRenderable(r, {
      id: "input-box",
      width: "100%",
      height: 4,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      focusedBorderColor: colors.focusBorder,
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

    // Footer
    this.footer = new TextRenderable(r, {
      id: "footer",
      width: "100%",
      paddingLeft: 1,
      paddingRight: 1,
      content: t`${dim("Ready")}`,
    });

    // Assemble
    this.root.add(this.header);
    this.root.add(this.chatScroll);
    this.root.add(this.inputBox);
    this.root.add(this.footer);
    r.root.add(this.root);

    this.textarea.focus();
  }

  // ==========================================================================
  // Agent event wiring
  // ==========================================================================

  private wireAgentEvents(): void {
    this.agent.subscribe((event: AgentEvent) => {
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
          this.onToolStart(event.toolName, event.args);
          break;
        case "tool_execution_end":
          this.onToolEnd(event.toolName, event.isError);
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
        this.currentThinking = this.addMessageBlock("thinking");
        break;

      case "thinking_delta":
        if (this.currentThinking?.text) {
          const current = this.currentThinking.text.content;
          const currentStr = typeof current === "string" ? current : "";
          this.currentThinking.text.content = t`${dim(currentStr + ame.delta)}`;
        }
        break;

      case "thinking_end":
        this.currentThinking = null;
        break;

      case "toolcall_start":
        // Tool calls will be shown via tool_execution_start/end
        break;

      case "done":
      case "error":
        break;
    }
  }

  private onMessageEnd(_message: unknown): void {
    this.currentAssistant = null;
    this.currentThinking = null;
  }

  private onToolStart(toolName: string, _args: unknown): void {
    const block = this.addMessageBlock("tool");
    if (block.text) {
      block.text.content = t`${fg(colors.toolLabel)(dim(`  ⚙ ${toolName}...`))}`;
    }
  }

  private onToolEnd(toolName: string, isError: boolean): void {
    const block = this.addMessageBlock("status");
    if (block.text) {
      if (isError) {
        block.text.content = t`${fg(colors.errorFg)(dim(`  ✗ ${toolName} failed`))}`;
      } else {
        block.text.content = t`${fg(colors.successFg)(dim(`  ✓ ${toolName}`))}`;
      }
    }
  }

  private onTurnEnd(message: unknown): void {
    const msg = message as AssistantMessage;
    if (msg.role === "assistant" && msg.usage) {
      this.totalTokensIn += msg.usage.input;
      this.totalTokensOut += msg.usage.output;

      if (msg.stopReason === "aborted") {
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
      if (text === "/quit" || text === "/exit") {
        this.destroy();
        process.exit(0);
      }

      if (text === "/clear") {
        this.agent.clearMessages();
        this.clearChat();
        this.addStatusMessage(t`${dim("Conversation cleared.")}`);
        this.textarea.initialValue = "";
        this.textarea.focus();
        return;
      }

      if (text === "/reset") {
        this.agent.reset();
        this.clearChat();
        this.addStatusMessage(t`${dim("Agent reset.")}`);
        this.textarea.initialValue = "";
        this.textarea.focus();
        return;
      }

      // Add user message to chat
      this.addUserMessage(text);
      this.textarea.initialValue = "";

      // Send to agent
      this.agent.prompt(text).catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.addErrorMessage(errMsg);
        this.updateFooter();
        this.textarea.focus();
      });
    };

    // Ctrl+C handling
    this.renderer.keyInput.on("keypress", (key: KeyEvent) => {
      if (key.name === "c" && key.ctrl) {
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
    });
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
      // Label
      const label = new TextRenderable(r, {
        width: "100%",
        content: t`${bold(fg(colors.assistantLabel)("Assistant"))}`,
      });
      container.add(label);

      // Markdown body (streaming)
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
      // tool, status
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
      content: typeof content === "string" ? content : content,
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
    this.totalTokensIn = 0;
    this.totalTokensOut = 0;
  }

  // ==========================================================================
  // Footer
  // ==========================================================================

  private updateFooter(status?: string): void {
    const streaming = this.agent.state.isStreaming;
    const statusText = status ?? (streaming ? "Working..." : "Ready");
    const tokenInfo =
      this.totalTokensIn > 0 ? ` | ${this.totalTokensIn}in/${this.totalTokensOut}out` : "";

    this.footer.content = t`${dim(`${statusText}${tokenInfo} | ${this.provider}/${this.modelId}`)}`;
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  destroy(): void {
    this.syntaxStyle.destroy();
    this.renderer.destroy();
  }
}
