import { ChatPanel, StatusBar, useBridge, useChat } from "@agentik/office-common";
import { useEffect, useState } from "react";
import { registerOutlookHandlers } from "../handlers/index.js";

declare const __BRIDGE_URL__: string;

export function App() {
  const [error, setError] = useState<string>();

  const { client, state, sessionId, connect } = useBridge({
    url: __BRIDGE_URL__,
    appType: "outlook",
  });

  const { messages, isStreaming, sendMessage, abort } = useChat(client);

  // Auto-connect on mount
  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (!client) return;
    return registerOutlookHandlers(client);
  }, [client]);

  useEffect(() => {
    if (!client) return;
    return client.on("error", (_code, message) => setError(message));
  }, [client]);

  return (
    <div className="flex flex-col h-screen bg-background font-sans">
      <header className="flex items-center justify-between py-3 pl-4 pr-3 border-b border-muted">
        <span className="text-sm font-semibold text-foreground">&#9889; Agentik</span>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col">
        <ChatPanel
          messages={messages}
          isStreaming={isStreaming}
          onSendMessage={sendMessage}
          onAbort={abort}
          disabled={state !== "ready"}
        />
      </div>

      <StatusBar state={state} sessionId={sessionId} error={error} />
    </div>
  );
}
