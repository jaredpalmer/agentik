import {
  FluentProvider,
  Tab,
  TabList,
  makeStyles,
  tokens,
  webLightTheme,
} from "@fluentui/react-components";
import { ChatPanel, SettingsPanel, StatusBar, useBridge, useChat } from "@agentik/office-common";
import { useCallback, useEffect, useState } from "react";
import { registerExcelHandlers } from "../handlers/index.js";
import { listenExcelContext } from "../context/excel-context.js";

declare const __BRIDGE_URL__: string;

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  tabContent: {
    flex: 1,
    overflow: "hidden",
  },
  tabList: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  contextBar: {
    padding: "4px 12px",
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

type TabValue = "chat" | "settings";

export function App() {
  const styles = useStyles();
  const [activeTab, setActiveTab] = useState<TabValue>("settings");
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string>();
  const [contextInfo, setContextInfo] = useState<string>("");

  const { client, state, sessionId, connect, disconnect } = useBridge({
    url: __BRIDGE_URL__,
    apiKey,
    provider,
    model: model || undefined,
    appType: "excel",
  });

  const { messages, isStreaming, sendMessage, abort, clearMessages } = useChat(client);

  // Register Excel tool handlers when client is available
  useEffect(() => {
    if (!client) return;
    const cleanup = registerExcelHandlers(client);
    return cleanup;
  }, [client]);

  // Listen for Excel context changes
  useEffect(() => {
    const cleanup = listenExcelContext((info) => {
      const parts: string[] = [];
      if (info.documentName) parts.push(info.documentName);
      if (info.activeContext) parts.push(info.activeContext);
      setContextInfo(parts.join(" | "));
    });
    return cleanup;
  }, []);

  // Listen for bridge errors
  useEffect(() => {
    if (!client) return;
    const unsub = client.on("error", (_code, message) => {
      setError(message);
    });
    return unsub;
  }, [client]);

  // Auto-switch to chat tab when connected
  useEffect(() => {
    if (state === "ready") {
      setActiveTab("chat");
      setError(undefined);
    }
  }, [state]);

  const handleConnect = useCallback(() => {
    setError(undefined);
    connect();
  }, [connect]);

  const handleDisconnect = useCallback(() => {
    clearMessages();
    disconnect();
    setActiveTab("settings");
  }, [clearMessages, disconnect]);

  const isConnected = state === "ready" || state === "connected";

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root}>
        <TabList
          className={styles.tabList}
          selectedValue={activeTab}
          onTabSelect={(_, data) => setActiveTab(data.value as TabValue)}
          size="small"
        >
          <Tab value="chat">Chat</Tab>
          <Tab value="settings">Settings</Tab>
        </TabList>

        {contextInfo && <div className={styles.contextBar}>{contextInfo}</div>}

        <div className={styles.tabContent}>
          {activeTab === "chat" ? (
            <ChatPanel
              messages={messages}
              isStreaming={isStreaming}
              onSendMessage={sendMessage}
              onAbort={abort}
              disabled={state !== "ready"}
            />
          ) : (
            <SettingsPanel
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              provider={provider}
              onProviderChange={setProvider}
              model={model}
              onModelChange={setModel}
              isConnected={isConnected}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          )}
        </div>

        <StatusBar state={state} sessionId={sessionId} error={error} />
      </div>
    </FluentProvider>
  );
}
