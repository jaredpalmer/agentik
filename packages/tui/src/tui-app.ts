import { BoxRenderable, TextRenderable, createCliRenderer, type CliRenderer } from "@opentui/core";
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
  private messagesView?: TextRenderable;
  private messages: DisplayMessage[] = [];
  private currentAssistantIndex?: number;
  private unsubscribe?: () => void;

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
    });
    this.messagesView = new TextRenderable(this.renderer, {
      id: "messages",
      width: "100%",
      height: "100%",
      content: "",
    });
    this.root.add(this.messagesView);
    this.renderer.root.add(this.root);
    this.renderer.start();
    this.unsubscribe = this.runtime.subscribe((event) => this.handleEvent(event));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.renderer?.destroy();
    this.renderer = undefined;
    this.root = undefined;
    this.messagesView = undefined;
    this.messages = [];
    this.currentAssistantIndex = undefined;
  }

  private handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case "message_start": {
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
        if (this.messages.length > 0) {
          const entry = this.formatMessage(event.message);
          this.messages[this.messages.length - 1] = entry;
          if (entry.role === "assistant") {
            this.currentAssistantIndex = undefined;
          }
          this.render();
        }
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
      return JSON.stringify(content, null, 2);
    }
    return JSON.stringify(message, null, 2);
  }

  private render(): void {
    if (!this.messagesView || !this.renderer) {
      return;
    }
    const text = this.messages
      .map((message) => `[${message.role}] ${message.content}`)
      .join("\n\n");
    this.messagesView.content = text;
    this.renderer.requestRender();
  }
}
