import { ChatPanel, StatusBar, useBridge, useChat } from "@agentik/office-common";
import { useEffect, useState } from "react";
import { registerExcelHandlers } from "../handlers/index.js";
import { listenExcelContext } from "../context/excel-context.js";

declare const __BRIDGE_URL__: string;

export function App() {
  const [error, setError] = useState<string>();
  const [contextInfo, setContextInfo] = useState("");

  const { client, state, sessionId, connect } = useBridge({
    url: __BRIDGE_URL__,
    appType: "excel",
  });

  const { messages, isStreaming, sendMessage, abort } = useChat(client);

  // Auto-connect on mount
  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (!client) return;
    return registerExcelHandlers(client);
  }, [client]);

  useEffect(() => {
    return listenExcelContext((info) => {
      const parts: string[] = [];
      if (info.documentName) parts.push(info.documentName);
      if (info.activeContext) parts.push(info.activeContext);
      setContextInfo(parts.join(" \u00b7 "));
    });
  }, []);

  useEffect(() => {
    if (!client) return;
    return client.on("error", (_code, message) => setError(message));
  }, [client]);

  return (
    <div className="flex flex-col h-screen bg-background font-sans">
      <header className="flex items-center justify-between py-3 pl-4 pr-3 border-b border-muted">
        <span className="text-sm font-semibold text-foreground">&#9889; Agentik</span>
      </header>

      {contextInfo && (
        <div className="py-1 px-4 text-[11px] text-muted-foreground bg-card border-b border-muted whitespace-nowrap overflow-hidden text-ellipsis">
          {contextInfo}
        </div>
      )}

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
