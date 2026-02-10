import { Badge, Card, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { useState } from "react";

export interface ToolCallCardProps {
  toolName: string;
  args: unknown;
  result?: string;
  isError?: boolean;
  isExecuting?: boolean;
}

const useStyles = makeStyles({
  card: {
    padding: "8px",
    marginTop: "4px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "4px",
  },
  args: {
    fontFamily: "monospace",
    fontSize: "11px",
    backgroundColor: tokens.colorNeutralBackground4,
    padding: "4px 8px",
    borderRadius: "4px",
    overflowX: "auto",
    whiteSpace: "pre-wrap",
    maxHeight: "120px",
    overflowY: "auto",
  },
  result: {
    marginTop: "4px",
    padding: "4px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    whiteSpace: "pre-wrap",
  },
  resultSuccess: {
    backgroundColor: tokens.colorPaletteGreenBackground1,
    color: tokens.colorPaletteGreenForeground1,
  },
  resultError: {
    backgroundColor: tokens.colorPaletteRedBackground1,
    color: tokens.colorPaletteRedForeground1,
  },
  toggle: {
    cursor: "pointer",
    fontSize: "11px",
    color: tokens.colorBrandForeground1,
    border: "none",
    background: "none",
    padding: 0,
  },
});

export function ToolCallCard({ toolName, args, result, isError, isExecuting }: ToolCallCardProps) {
  const styles = useStyles();
  const [showArgs, setShowArgs] = useState(false);

  return (
    <Card className={styles.card} size="small">
      <div className={styles.header}>
        <Badge appearance="outline" size="small">
          {toolName}
        </Badge>
        {isExecuting && <Spinner size="extra-tiny" />}
        {args != null && (
          <button className={styles.toggle} onClick={() => setShowArgs(!showArgs)} type="button">
            {showArgs ? "Hide params" : "Show params"}
          </button>
        )}
      </div>
      {showArgs && args && <div className={styles.args}>{JSON.stringify(args, null, 2)}</div>}
      {result != null && (
        <Text className={`${styles.result} ${isError ? styles.resultError : styles.resultSuccess}`}>
          {result}
        </Text>
      )}
    </Card>
  );
}
