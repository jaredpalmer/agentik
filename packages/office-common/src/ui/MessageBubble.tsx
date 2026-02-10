import { Text, makeStyles, tokens } from "@fluentui/react-components";
import type { ChatMessage } from "../hooks/useChat.js";
import { ToolCallCard } from "./ToolCallCard.js";

export interface MessageBubbleProps {
  message: ChatMessage;
}

const useStyles = makeStyles({
  wrapper: {
    display: "flex",
    flexDirection: "column",
    maxWidth: "85%",
  },
  userWrapper: {
    alignSelf: "flex-end",
  },
  assistantWrapper: {
    alignSelf: "flex-start",
  },
  bubble: {
    padding: "8px 12px",
    borderRadius: "8px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  userBubble: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  assistantBubble: {
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
  },
  thinking: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    padding: "4px 0",
  },
  toolSection: {
    marginTop: "4px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  roleLabel: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    marginBottom: "2px",
  },
});

export function MessageBubble({ message }: MessageBubbleProps) {
  const styles = useStyles();
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  if (isTool && message.toolResults) {
    return (
      <div className={`${styles.wrapper} ${styles.assistantWrapper}`}>
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

  return (
    <div className={`${styles.wrapper} ${isUser ? styles.userWrapper : styles.assistantWrapper}`}>
      <Text className={styles.roleLabel}>{isUser ? "You" : "Assistant"}</Text>
      {message.thinkingContent && (
        <Text className={styles.thinking}>{message.thinkingContent}</Text>
      )}
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.assistantBubble}`}>
        <Text>{message.content}</Text>
      </div>
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className={styles.toolSection}>
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
  );
}
