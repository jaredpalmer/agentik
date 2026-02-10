import { Badge, Text, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import type { BridgeClientState } from "../bridge-client.js";

export interface StatusBarProps {
  state: BridgeClientState;
  sessionId: string | null;
  error?: string;
}

const STATE_COLORS: Record<BridgeClientState, "success" | "warning" | "danger" | "informative"> = {
  disconnected: "danger",
  connecting: "warning",
  connected: "informative",
  ready: "success",
};

const STATE_LABELS: Record<BridgeClientState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting...",
  connected: "Connected",
  ready: "Ready",
};

const useStyles = makeStyles({
  container: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 12px",
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    minHeight: "28px",
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: "12px",
  },
  sessionId: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    fontFamily: "monospace",
  },
});

export function StatusBar({ state, sessionId, error }: StatusBarProps) {
  const styles = useStyles();
  const truncatedId = sessionId ? sessionId.slice(0, 8) : null;

  return (
    <div className={styles.container}>
      <Badge color={STATE_COLORS[state]} size="small">
        {STATE_LABELS[state]}
      </Badge>
      {truncatedId && (
        <Tooltip content={sessionId!} relationship="description">
          <Text className={styles.sessionId}>{truncatedId}</Text>
        </Tooltip>
      )}
      {error && <Text className={styles.error}>{error}</Text>}
    </div>
  );
}
