import type { BridgeClientState } from "../bridge-client.js";
import { cn } from "./utils.js";

export interface StatusBarProps {
  state: BridgeClientState;
  sessionId: string | null;
  error?: string;
}

const STATE_LABELS: Record<BridgeClientState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting...",
  connected: "Connected",
  ready: "Ready",
};

const DOT_COLORS: Record<BridgeClientState, string> = {
  disconnected: "bg-red-500",
  connecting: "bg-amber-500",
  connected: "bg-blue-500",
  ready: "bg-green-500",
};

export function StatusBar({ state, error }: StatusBarProps) {
  return (
    <div className="flex items-center gap-1.5 py-1.5 px-4 border-t border-muted">
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", DOT_COLORS[state])} />
      <span className="text-[11px] text-muted-foreground">{STATE_LABELS[state]}</span>
      {error && (
        <span className="text-[11px] text-destructive ml-auto overflow-hidden text-ellipsis whitespace-nowrap">
          {error}
        </span>
      )}
    </div>
  );
}
