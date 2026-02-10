import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "../hooks/useChat.js";
import { ArrowUpIcon, SquareIcon } from "./icons.js";
import { MessageBubble } from "./MessageBubble.js";
import { cn } from "./utils.js";

export interface ChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (content: string) => void;
  onAbort: () => void;
  disabled?: boolean;
}

export function ChatPanel({
  messages,
  isStreaming,
  onSendMessage,
  onAbort,
  disabled,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [input]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSendMessage(trimmed);
    setInput("");
  }, [input, disabled, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const isDisabled = !input.trim() || disabled;

  return (
    <div className="flex flex-col h-full">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6">
          <span className="text-base font-medium text-muted-foreground">What can I help with?</span>
        </div>
      ) : (
        <div ref={listRef} className="flex-1 overflow-y-auto pt-4 pb-2 px-4 flex flex-col gap-5">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      )}
      <div className="px-4 pb-4 pt-2">
        <div className="flex items-end border border-border rounded-[14px] py-2 pl-3.5 pr-1.5 bg-background transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:shadow-[0_0_0_1px_var(--border)]">
          <textarea
            ref={textareaRef}
            className="flex-1 border-0 outline-none resize-none font-[inherit] text-sm leading-5 text-foreground bg-transparent max-h-[120px] min-h-5 p-0 pr-2 placeholder:text-muted-foreground"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Agentik..."
            rows={1}
            disabled={disabled}
          />
          {isStreaming ? (
            <button
              className="flex items-center justify-center w-7 h-7 rounded-lg border-0 bg-foreground text-background cursor-pointer shrink-0 transition-colors duration-150 hover:bg-foreground/80"
              onClick={onAbort}
              type="button"
            >
              <SquareIcon size={12} />
            </button>
          ) : (
            <button
              className={cn(
                "flex items-center justify-center w-7 h-7 rounded-lg border-0 bg-foreground text-background cursor-pointer shrink-0 transition-colors duration-150 hover:bg-foreground/80",
                isDisabled && "bg-border text-muted-foreground cursor-default hover:bg-border"
              )}
              onClick={handleSubmit}
              disabled={isDisabled}
              type="button"
            >
              <ArrowUpIcon size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
