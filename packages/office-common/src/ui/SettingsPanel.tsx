interface SettingsPanelProps {
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
  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6 py-8">
      <div className="flex flex-col items-center gap-1 mb-7">
        <span className="text-2xl mb-1">&#9889;</span>
        <h2 className="text-base font-semibold text-foreground m-0">Agentik</h2>
        <p className="text-[13px] text-muted-foreground m-0">
          {isConnected ? "Connected" : "Enter your API key to get started"}
        </p>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-80">
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-foreground/80">API Key</label>
          <input
            type="password"
            className="py-2 px-3 border border-input rounded-lg text-sm text-foreground bg-background font-[inherit] outline-none transition-colors duration-150 focus:border-foreground disabled:bg-muted/50 disabled:text-muted-foreground placeholder:text-muted-foreground"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="sk-..."
            disabled={isConnected}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-foreground/80">Provider</label>
          <select
            className="py-2 px-3 border border-input rounded-lg text-sm text-foreground bg-background font-[inherit] outline-none cursor-pointer transition-colors duration-150 focus:border-foreground disabled:bg-muted/50 disabled:text-muted-foreground"
            value={provider}
            onChange={(e) => onProviderChange(e.target.value)}
            disabled={isConnected}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-foreground/80">Model</label>
          <input
            className="py-2 px-3 border border-input rounded-lg text-sm text-foreground bg-background font-[inherit] outline-none transition-colors duration-150 focus:border-foreground disabled:bg-muted/50 disabled:text-muted-foreground placeholder:text-muted-foreground"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder="Optional"
            disabled={isConnected}
          />
        </div>

        {isConnected ? (
          <button
            className="py-2.5 px-4 border border-border rounded-lg text-sm font-medium text-foreground/80 bg-background font-[inherit] cursor-pointer transition-colors duration-150 hover:bg-muted/50 hover:border-ring"
            onClick={onDisconnect}
            type="button"
          >
            Disconnect
          </button>
        ) : (
          <button
            className="py-2.5 px-4 border-0 rounded-lg text-sm font-medium text-primary-foreground bg-primary font-[inherit] cursor-pointer transition-colors duration-150 hover:bg-primary/80 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-default"
            onClick={onConnect}
            disabled={!apiKey}
            type="button"
          >
            Connect
          </button>
        )}
      </div>
    </div>
  );
}
