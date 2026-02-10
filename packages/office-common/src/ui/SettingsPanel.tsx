import { Button, Field, Input, Select, makeStyles, tokens } from "@fluentui/react-components";

export interface SettingsPanelProps {
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  provider: string;
  onProviderChange: (provider: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
  },
  header: {
    fontSize: "16px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
    marginBottom: "4px",
  },
});

export function SettingsPanel({
  apiKey,
  onApiKeyChange,
  provider,
  onProviderChange,
  model,
  onModelChange,
  isConnected,
  onConnect,
  onDisconnect,
}: SettingsPanelProps) {
  const styles = useStyles();

  return (
    <div className={styles.container}>
      <div className={styles.header}>Settings</div>

      <Field label="API Key">
        <Input
          type="password"
          value={apiKey}
          onChange={(_, data) => onApiKeyChange(data.value)}
          placeholder="Enter your API key"
          disabled={isConnected}
        />
      </Field>

      <Field label="Provider">
        <Select
          value={provider}
          onChange={(_, data) => onProviderChange(data.value)}
          disabled={isConnected}
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
        </Select>
      </Field>

      <Field label="Model">
        <Input
          value={model}
          onChange={(_, data) => onModelChange(data.value)}
          placeholder="Model name (optional)"
          disabled={isConnected}
        />
      </Field>

      {isConnected ? (
        <Button appearance="secondary" onClick={onDisconnect}>
          Disconnect
        </Button>
      ) : (
        <Button appearance="primary" onClick={onConnect} disabled={!apiKey}>
          Connect
        </Button>
      )}
    </div>
  );
}
