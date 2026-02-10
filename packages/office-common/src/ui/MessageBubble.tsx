import type { ChatMessage } from "../hooks/useChat.js";
import { ToolCallCard } from "./ToolCallCard.js";

export interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  if (isTool && message.toolResults) {
    return (
      <div className="flex flex-col gap-2">
        {message.toolResults.map((result) => (
          <ToolCallCard
            key={result.toolCallId}
            toolName={result.toolName}
            args={{}}
            result={result.content}
            isError={result.isError}
          />
        ))}
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex flex-col gap-2">
        <div className="self-end max-w-[85%] bg-muted text-foreground py-2 px-3.5 rounded-2xl text-sm leading-5 whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        {message.thinkingContent && (
          <div className="text-xs text-muted-foreground italic leading-[18px]">
            {message.thinkingContent}
          </div>
        )}
        {message.content && (
          <div className="text-sm leading-[22px] text-foreground whitespace-pre-wrap break-words">
            {message.content}
          </div>
        )}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-col gap-1">
            {message.toolCalls.map((tc) => (
              <ToolCallCard
                key={tc.id}
                toolName={tc.name}
                args={tc.args}
                isExecuting={message.isStreaming}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
