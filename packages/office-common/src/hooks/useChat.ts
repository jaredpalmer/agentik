import type {
  AgentEvent,
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from "@agentik/agent";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BridgeClient } from "../bridge-client.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolCalls?: { id: string; name: string; args: unknown }[];
  toolResults?: {
    toolCallId: string;
    toolName: string;
    content: string;
    isError: boolean;
  }[];
  isStreaming?: boolean;
  thinkingContent?: string;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage: (content: string) => void;
  steerMessage: (content: string) => void;
  abort: () => void;
  clearMessages: () => void;
}

let messageCounter = 0;
function nextId(): string {
  return `msg-${++messageCounter}-${Date.now()}`;
}

function extractText(content: AssistantMessage["content"]): string {
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function extractThinking(content: AssistantMessage["content"]): string {
  return content
    .filter((c): c is ThinkingContent => c.type === "thinking")
    .map((c) => c.thinking)
    .join("");
}

function extractToolCalls(content: AssistantMessage["content"]): ChatMessage["toolCalls"] {
  const calls = content.filter((c): c is ToolCall => c.type === "toolCall");
  if (calls.length === 0) return undefined;
  return calls.map((c) => ({ id: c.id, name: c.name, args: c.arguments }));
}

export function useChat(client: BridgeClient | null): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const streamingIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!client) return;

    const unsub = client.on("agentEvent", (event: AgentEvent) => {
      switch (event.type) {
        case "agent_start":
          setIsStreaming(true);
          break;

        case "agent_end":
          setIsStreaming(false);
          streamingIdRef.current = null;
          break;

        case "message_start": {
          const msg = event.message;
          if (msg.role === "assistant") {
            const am = msg;
            const id = nextId();
            streamingIdRef.current = id;
            setMessages((prev) => [
              ...prev,
              {
                id,
                role: "assistant",
                content: extractText(am.content),
                timestamp: am.timestamp,
                toolCalls: extractToolCalls(am.content),
                isStreaming: true,
                thinkingContent: extractThinking(am.content),
              },
            ]);
          }
          break;
        }

        case "message_update": {
          const msg = event.message;
          if (msg.role === "assistant" && streamingIdRef.current) {
            const am = msg;
            const currentId = streamingIdRef.current;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === currentId
                  ? {
                      ...m,
                      content: extractText(am.content),
                      toolCalls: extractToolCalls(am.content),
                      thinkingContent: extractThinking(am.content),
                    }
                  : m
              )
            );
          }
          break;
        }

        case "message_end": {
          const msg = event.message;
          if (msg.role === "assistant" && streamingIdRef.current) {
            const am = msg;
            const currentId = streamingIdRef.current;
            streamingIdRef.current = null;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === currentId
                  ? {
                      ...m,
                      content: extractText(am.content),
                      toolCalls: extractToolCalls(am.content),
                      thinkingContent: extractThinking(am.content),
                      isStreaming: false,
                    }
                  : m
              )
            );
          }
          break;
        }

        case "tool_execution_end": {
          const result = event.result as ToolResultMessage | undefined;
          if (result && result.role === "toolResult") {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: "tool",
                content: result.content
                  .filter((c): c is TextContent => c.type === "text")
                  .map((c) => c.text)
                  .join(""),
                timestamp: result.timestamp,
                toolResults: [
                  {
                    toolCallId: result.toolCallId,
                    toolName: result.toolName,
                    content: result.content
                      .filter((c): c is TextContent => c.type === "text")
                      .map((c) => c.text)
                      .join(""),
                    isError: result.isError,
                  },
                ],
              },
            ]);
          }
          break;
        }
      }
    });

    return unsub;
  }, [client]);

  const sendMessage = useCallback(
    (content: string) => {
      if (!client) return;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "user",
          content,
          timestamp: Date.now(),
        },
      ]);
      client.sendPrompt(content);
    },
    [client]
  );

  const steerMessage = useCallback(
    (content: string) => {
      if (!client) return;
      client.sendSteer(content);
    },
    [client]
  );

  const abort = useCallback(() => {
    client?.sendAbort();
  }, [client]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isStreaming,
    sendMessage,
    steerMessage,
    abort,
    clearMessages,
  };
}
