import { useState } from "react";
import { ChevronIcon } from "./icons.js";
import { cn } from "./utils.js";

export interface ToolCallCardProps {
  toolName: string;
  args: unknown;
  result?: string;
  isError?: boolean;
  isExecuting?: boolean;
}

export function ToolCallCard({ toolName, args, result, isError, isExecuting }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = args != null || result != null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="flex items-center gap-1.5 py-1.5 px-2.5 bg-card w-full cursor-pointer font-[inherit] border-0 hover:bg-muted"
        onClick={() => hasDetails && setExpanded(!expanded)}
        type="button"
      >
        {hasDetails && (
          <ChevronIcon
            size={10}
            direction={expanded ? "down" : "right"}
            className="text-muted-foreground shrink-0"
          />
        )}
        <span className="text-xs font-medium text-foreground/80 font-mono">{toolName}</span>
        {isExecuting && (
          <span className="text-[11px] text-muted-foreground ml-auto">running...</span>
        )}
      </button>
      {expanded && (
        <>
          {args != null && Object.keys(args as object).length > 0 && (
            <pre className="font-mono text-[11px] leading-4 text-foreground/80 bg-card py-1.5 px-2.5 border-t border-muted overflow-x-auto whitespace-pre-wrap break-all max-h-[100px] overflow-y-auto m-0">
              {JSON.stringify(args, null, 2)}
            </pre>
          )}
          {result != null && (
            <div
              className={cn(
                "text-xs leading-[18px] py-1.5 px-2.5 border-t border-muted whitespace-pre-wrap break-words max-h-[100px] overflow-y-auto",
                isError ? "text-red-900 bg-red-50" : "text-green-900 bg-green-50"
              )}
            >
              {result}
            </div>
          )}
        </>
      )}
    </div>
  );
}
