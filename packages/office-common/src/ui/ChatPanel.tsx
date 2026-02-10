import { Button, Input, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../hooks/useChat.js";
import { MessageBubble } from "./MessageBubble.js";

export interface ChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (content: string) => void;
  onAbort: () => void;
  disabled?: boolean;
}

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  messageList: {
    flex: 1,
    overflowY: "auto",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  inputArea: {
    padding: "12px",
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
  input: {
    flex: 1,
  },
});

export function ChatPanel({
  messages,
  isStreaming,
  onSendMessage,
  onAbort,
  disabled,
}: ChatPanelProps) {
  const styles = useStyles();
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || disabled) return;
      onSendMessage(trimmed);
      setInput("");
    },
    [input, disabled, onSendMessage]
  );

  return (
    <div className={styles.container}>
      <div ref={listRef} className={styles.messageList}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isStreaming && <Spinner size="tiny" label="Thinking..." />}
      </div>
      <form className={styles.inputArea} onSubmit={handleSubmit}>
        <Input
          className={styles.input}
          value={input}
          onChange={(_, data) => setInput(data.value)}
          placeholder="Type a message..."
          disabled={disabled}
        />
        {isStreaming ? (
          <Button appearance="secondary" onClick={onAbort}>
            Stop
          </Button>
        ) : (
          <Button appearance="primary" type="submit" disabled={disabled || !input.trim()}>
            Send
          </Button>
        )}
      </form>
    </div>
  );
}
