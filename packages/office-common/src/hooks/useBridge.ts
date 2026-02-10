import { useCallback, useEffect, useRef, useState } from "react";
import { BridgeClient, type BridgeClientState } from "../bridge-client.js";

export interface UseBridgeOptions {
  url: string;
  apiKey: string;
  provider?: string;
  model?: string;
  appType?: "excel" | "powerpoint" | "outlook";
}

export interface UseBridgeReturn {
  client: BridgeClient | null;
  state: BridgeClientState;
  sessionId: string | null;
  connect: () => void;
  disconnect: () => void;
}

export function useBridge(options: UseBridgeOptions): UseBridgeReturn {
  const [state, setState] = useState<BridgeClientState>("disconnected");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const clientRef = useRef<BridgeClient | null>(null);

  useEffect(() => {
    if (!options.apiKey) {
      clientRef.current = null;
      setState("disconnected");
      setSessionId(null);
      return;
    }

    const client = new BridgeClient({
      url: options.url,
      apiKey: options.apiKey,
      provider: options.provider,
      model: options.model,
      appType: options.appType,
    });

    const unsubs = [
      client.on("stateChange", (s) => setState(s)),
      client.on("sessionReady", (id) => setSessionId(id)),
    ];

    clientRef.current = client;

    return () => {
      unsubs.forEach((fn) => fn());
      client.disconnect();
      clientRef.current = null;
    };
  }, [options.url, options.apiKey, options.provider, options.model, options.appType]);

  const connect = useCallback(() => {
    clientRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    setState("disconnected");
    setSessionId(null);
  }, []);

  return {
    client: clientRef.current,
    state,
    sessionId,
    connect,
    disconnect,
  };
}
