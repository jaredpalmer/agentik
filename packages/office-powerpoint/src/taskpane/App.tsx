import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ChatPanel, SettingsPanel, StatusBar, useBridge, useChat } from "@agentik/office-common";
import { useEffect, useState } from "react";
import { registerPowerPointHandlers } from "../handlers/index.js";

declare const __BRIDGE_URL__: string;

export function App() {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem("apiKey") ?? "");
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");

  const { client, state, sessionId, connect, disconnect } = useBridge({
    url: __BRIDGE_URL__,
    apiKey,
    provider,
    model: model || undefined,
    appType: "powerpoint",
  });

  const { messages, isStreaming, sendMessage, abort } = useChat(client);

  useEffect(() => {
    if (!client) return;
    return registerPowerPointHandlers(client);
  }, [client]);

  const handleApiKeyChange = (key: string) => {
    setApiKey(key);
    sessionStorage.setItem("apiKey", key);
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        {state !== "ready" ? (
          <SettingsPanel
            apiKey={apiKey}
            onApiKeyChange={handleApiKeyChange}
            provider={provider}
            onProviderChange={setProvider}
            model={model}
            onModelChange={setModel}
            isConnected={state === "connected"}
            onConnect={connect}
            onDisconnect={disconnect}
          />
        ) : (
          <ChatPanel
            messages={messages}
            isStreaming={isStreaming}
            onSendMessage={sendMessage}
            onAbort={abort}
          />
        )}
        <StatusBar state={state} sessionId={sessionId} />
      </div>
    </FluentProvider>
  );
}
