# Agentik

A modular, streaming-first AI agent framework built on [AI SDK 6](https://sdk.vercel.ai/). Designed for building coding agents and tool-using LLM applications with full control over the conversation loop.

## Architecture

```
agentik/
  packages/
    agent/          # @agentik/agent - core agent loop, types, state management
    coding-agent/   # @agentik/coding-agent - 7 coding tools + extensible TUI
```

Agentik is a Bun monorepo with two packages:

- **`@agentik/agent`** is the core library. It provides the agent loop, streaming event system, message types, extension system, and stateful `Agent` class. It depends only on `ai` (AI SDK 6) and `zod`.
- **`@agentik/coding-agent`** is a concrete agent with 7 coding tools (bash, read, write, edit, glob, grep, ls), 3 built-in extensions, a file-based extension loader, slash commands, keyboard shortcuts, CLI flags, UI primitives, an event bus, and a terminal UI.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.3+
- [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) for the grep tool
- An API key for Anthropic or OpenAI

### Install & Build

```bash
bun install
bun run build
```

### Run the TUI

```bash
# Anthropic (default)
ANTHROPIC_API_KEY=sk-ant-... bun run packages/coding-agent/src/cli.ts

# OpenAI
AGENTIK_PROVIDER=openai OPENAI_API_KEY=sk-... AGENTIK_MODEL=gpt-4o bun run packages/coding-agent/src/cli.ts
```

### Run Tests

```bash
bun test
```

This builds the project and runs all 211 tests across both packages.

---

## `@agentik/agent` - Core Library

### Overview

The core library implements a streaming agent loop that:

1. Takes user messages and a set of tools
2. Calls the LLM via AI SDK's `streamText`
3. Streams back text, thinking, and tool calls as events
4. Executes tool calls and feeds results back to the LLM
5. Repeats until the LLM stops producing tool calls
6. Supports mid-run steering (interrupt) and post-completion follow-up messages
7. Provides an extension system for chainable hooks, runtime tool registration, typed events, input interception, and tool call interception

### The Agent Loop

The agent loop is the heart of the framework. It manages the LLM conversation cycle:

```
User Message(s) → LLM → Text/ToolCalls → Execute Tools → Tool Results → LLM → ...
```

The loop continues as long as the LLM produces tool calls. When it stops (produces only text), the loop checks for follow-up messages. If none exist, the agent stops.

#### Steering Messages

Steering messages let you interrupt the agent mid-run. After each tool execution, the loop checks for queued steering messages. If found, remaining tool calls are skipped and the steering message is injected into the conversation before the next LLM call.

#### Follow-up Messages

Follow-up messages are processed after the agent would otherwise stop. This enables multi-turn workflows where you queue additional instructions that run after the current task completes.

### Low-Level API: `agentLoop` / `agentLoopContinue`

The low-level API returns an `EventStream` that you consume with `for await`:

```typescript
import { agentLoop } from "@agentik/agent";
import type { AgentContext, AgentLoopConfig, AgentMessage, Message } from "@agentik/agent";

const context: AgentContext = {
  systemPrompt: "You are a helpful assistant.",
  messages: [],
  tools: [],
};

const config: AgentLoopConfig = {
  model: yourLanguageModel,
  convertToLlm: (messages: AgentMessage[]) =>
    messages.filter(
      (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"
    ) as Message[],
};

const prompts: AgentMessage[] = [{ role: "user", content: "Hello!", timestamp: Date.now() }];

const stream = agentLoop(prompts, context, config);

for await (const event of stream) {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
      break;
    case "tool_execution_start":
      console.log(`Running tool: ${event.toolName}`);
      break;
    case "agent_end":
      console.log("Agent finished");
      break;
  }
}
```

Use `agentLoopContinue` to resume from an existing context (e.g., after an overflow or error).

### High-Level API: `Agent` class

The `Agent` class wraps the loop with state management, event subscriptions, and message queuing:

```typescript
import { Agent } from "@agentik/agent";

const agent = new Agent({
  initialState: {
    model: yourLanguageModel,
    systemPrompt: "You are a helpful assistant.",
    tools: myTools,
  },
  maxTokens: 8192,
  temperature: 0.7,
  steeringMode: "one-at-a-time", // or "all"
  followUpMode: "one-at-a-time", // or "all"
});

// Subscribe to streaming events
const unsubscribe = agent.subscribe((event) => {
  if (event.type === "message_update") {
    const ame = event.assistantMessageEvent;
    if (ame.type === "text_delta") {
      process.stdout.write(ame.delta);
    }
  }
});

// Send a prompt and wait for completion
await agent.prompt("Explain how async iterators work in JavaScript.");

// Access conversation history
console.log(agent.state.messages);

// Queue a follow-up
agent.followUp({
  role: "user",
  content: "Now give me a code example.",
  timestamp: Date.now(),
});
await agent.prompt("Continue with the example.");

// Interrupt mid-run
agent.steer({
  role: "user",
  content: "Stop what you're doing and focus on error handling instead.",
  timestamp: Date.now(),
});

// Clean up
unsubscribe();
```

#### Agent Options

| Option             | Type                                                         | Default                              | Description                                                |
| ------------------ | ------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------- |
| `initialState`     | `Partial<AgentState>`                                        | `{}`                                 | Initial state (model, systemPrompt, tools, messages, etc.) |
| `convertToLlm`     | `(msgs: AgentMessage[]) => Message[]`                        | Filters to user/assistant/toolResult | Converts agent messages to LLM-compatible messages         |
| `transformContext` | `(msgs: AgentMessage[], signal?) => Promise<AgentMessage[]>` | none                                 | Pre-processing hook for context pruning or injection       |
| `steeringMode`     | `"all" \| "one-at-a-time"`                                   | `"one-at-a-time"`                    | How many queued steering messages to deliver per check     |
| `followUpMode`     | `"all" \| "one-at-a-time"`                                   | `"one-at-a-time"`                    | How many queued follow-up messages to deliver per check    |
| `maxTokens`        | `number`                                                     | undefined                            | Max output tokens for LLM response                         |
| `temperature`      | `number`                                                     | undefined                            | Temperature for LLM response                               |
| `providerOptions`  | `Record<string, unknown>`                                    | undefined                            | Provider-specific options passed to AI SDK                 |
| `thinkingBudgets`  | `ThinkingBudgets`                                            | undefined                            | Custom token budgets per thinking level                    |

### Thinking / Reasoning

Agentik supports configurable thinking/reasoning levels that map to budget token limits sent to the LLM provider:

```typescript
agent.setThinkingLevel("medium"); // off | minimal | low | medium | high | xhigh
```

Default budgets:

| Level     | Budget Tokens |
| --------- | ------------- |
| `minimal` | 1,024         |
| `low`     | 4,096         |
| `medium`  | 10,000        |
| `high`    | 32,000        |
| `xhigh`   | 100,000       |

Override with custom budgets:

```typescript
const agent = new Agent({
  thinkingBudgets: {
    medium: 20000,
    high: 50000,
  },
});
```

### Event System

The agent emits a rich set of events for real-time UI updates:

#### Agent Lifecycle Events

| Event         | Description                                                    |
| ------------- | -------------------------------------------------------------- |
| `agent_start` | Agent loop begins                                              |
| `agent_end`   | Agent loop completes (includes all messages produced)          |
| `turn_start`  | New LLM turn begins                                            |
| `turn_end`    | LLM turn completes (includes assistant message + tool results) |

#### Message Events

| Event            | Description                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| `message_start`  | New message begins (user, assistant, or tool result)                   |
| `message_update` | Streaming update to assistant message (text/thinking/tool call deltas) |
| `message_end`    | Message is finalized                                                   |

#### Assistant Message Events (nested inside `message_update`)

| Event                                                | Description                                 |
| ---------------------------------------------------- | ------------------------------------------- |
| `text_start` / `text_delta` / `text_end`             | Text content streaming                      |
| `thinking_start` / `thinking_delta` / `thinking_end` | Thinking/reasoning streaming                |
| `toolcall_start` / `toolcall_delta` / `toolcall_end` | Tool call input streaming                   |
| `done`                                               | Assistant message complete with stop reason |
| `error`                                              | Assistant message errored                   |

#### Tool Execution Events

| Event                   | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `tool_execution_start`  | Tool begins executing (includes tool name and args) |
| `tool_execution_update` | Partial tool result (for progress updates)          |
| `tool_execution_end`    | Tool finished (includes result and error status)    |

### Message Types

Messages in Agentik follow a structured format with three core roles:

```typescript
// User messages
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

// Assistant messages (from the LLM)
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  model: string;
  usage: Usage;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
  errorMessage?: string;
  timestamp: number;
}

// Tool result messages
interface ToolResultMessage<TDetails = unknown> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;
}
```

#### Extensible Messages via Declaration Merging

You can extend the message system with custom message types using TypeScript declaration merging:

```typescript
// Define your custom messages
interface ArtifactMessage {
  role: "artifact";
  artifactId: string;
  content: string;
  language: string;
  timestamp: number;
}

// Extend via declaration merging
declare module "@agentik/agent" {
  interface CustomAgentMessages {
    artifact: ArtifactMessage;
  }
}

// Now ArtifactMessage is part of AgentMessage union
const msg: AgentMessage = {
  role: "artifact",
  artifactId: "abc",
  content: "console.log('hello')",
  language: "typescript",
  timestamp: Date.now(),
};
```

Custom messages are carried through the conversation but filtered out before LLM calls by the `convertToLlm` function.

### Defining Tools

Tools use Zod schemas for parameter validation and are fully type-safe:

```typescript
import { z } from "zod";
import type { AgentTool } from "@agentik/agent";

const myTool: AgentTool<{ query: string }, { resultCount: number }> = {
  name: "search",
  label: "Search",
  description: "Search for documents matching a query",
  parameters: z.object({
    query: z.string().describe("The search query"),
  }),
  async execute(toolCallId, params, signal, onUpdate) {
    // params is typed as { query: string }

    // Optional: send progress updates
    onUpdate?.({
      content: [{ type: "text", text: "Searching..." }],
      details: { resultCount: 0 },
    });

    const results = await performSearch(params.query);

    return {
      content: [{ type: "text", text: results.map((r) => r.title).join("\n") }],
      details: { resultCount: results.length },
    };
  },
};
```

#### Tool interface

| Field         | Type                                                                   | Description                       |
| ------------- | ---------------------------------------------------------------------- | --------------------------------- |
| `name`        | `string`                                                               | Unique identifier sent to the LLM |
| `label`       | `string`                                                               | Human-readable display name       |
| `description` | `string`                                                               | Description sent to the LLM       |
| `parameters`  | `z.ZodType<TParams>`                                                   | Zod schema for input validation   |
| `execute`     | `(toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult>` | Execution function                |

### EventStream

The `EventStream<T, R>` class is a generic async iterable for producer/consumer patterns. Events are pushed in and consumed via `for await...of`:

```typescript
import { EventStream } from "@agentik/agent";

const stream = new EventStream<MyEvent, MyResult>(
  (event) => event.type === "done", // completion predicate
  (event) => event.result // result extractor
);

// Producer side
stream.push({ type: "data", value: 42 });
stream.push({ type: "done", result: "complete" });

// Consumer side
for await (const event of stream) {
  console.log(event);
}

// Get the final result
const result = await stream.result(); // "complete"
```

### Extension System

Extensions add capabilities to an agent via chainable hooks, runtime tool registration, typed event subscriptions, input interception, and tool call interception. An extension is a function that receives an `ExtensionAPI` and optionally returns a cleanup function:

```typescript
import type { Extension } from "@agentik/agent";

const myExtension: Extension = (api) => {
  // Register hooks, tools, event listeners
  api.on("beforeToolCall", async (toolCall, tool) => {
    console.log(`About to call ${toolCall.name}`);
    return { action: "continue" };
  });

  // Optional: return cleanup function
  return () => {
    console.log("Extension removed");
  };
};

// Register with agent — returns a dispose function
const dispose = agent.use(myExtension);

// Later, remove all hooks/tools registered by this extension
dispose();
```

When you call `dispose()`, every hook, tool, and event listener registered by that extension is removed automatically, along with calling the extension's own cleanup function.

#### ExtensionAPI Reference

| Method / Property                     | Description                                                         |
| ------------------------------------- | ------------------------------------------------------------------- |
| `state`                               | Read-only access to `AgentState`                                    |
| **Tool Management**                   |                                                                     |
| `registerTool(tool)`                  | Add a tool at runtime. Returns unregister function.                 |
| `unregisterTool(name)`                | Remove a tool by name. Returns `true` if found.                     |
| `getActiveTools()`                    | Get names of currently active tools.                                |
| `setActiveTools(names)`               | Set which tools are active (only active tools are sent to the LLM). |
| **Hooks**                             |                                                                     |
| `on("transformContext", hook)`        | Modify messages before LLM calls.                                   |
| `on("beforeToolCall", hook)`          | Intercept tool calls — block or modify args.                        |
| `on("afterToolResult", hook)`         | Modify tool results before they enter the conversation.             |
| `on("input", hook)`                   | Intercept user input before it becomes a message.                   |
| **Event Subscriptions**               |                                                                     |
| `on("event", listener)`               | Subscribe to all agent events (untyped).                            |
| `on("agent_start", handler)`          | Typed: agent loop begins.                                           |
| `on("agent_end", handler)`            | Typed: agent loop completes.                                        |
| `on("turn_start", handler)`           | Typed: new LLM turn begins.                                         |
| `on("turn_end", handler)`             | Typed: LLM turn completes.                                          |
| `on("message_start", handler)`        | Typed: message begins.                                              |
| `on("message_end", handler)`          | Typed: message finalized.                                           |
| `on("tool_execution_start", handler)` | Typed: tool begins executing.                                       |
| `on("tool_execution_end", handler)`   | Typed: tool finished.                                               |
| **Message Delivery**                  |                                                                     |
| `steer(message)`                      | Queue a steering message (interrupts mid-run).                      |
| `followUp(message)`                   | Queue a follow-up message (runs after current task).                |
| `sendUserMessage(content, options?)`  | Send a user message as steer or followUp.                           |
| **Model & Thinking**                  |                                                                     |
| `setModel(model)`                     | Change the LLM model at runtime.                                    |
| `getThinkingLevel()`                  | Get current thinking level.                                         |
| `setThinkingLevel(level)`             | Set thinking level.                                                 |

Every `on(...)` call returns an unsubscribe function `() => void`.

#### Hook Types

**TransformContextHook** — Runs before each LLM call. Multiple hooks chain sequentially (each receives the output of the previous). The base `transformContext` from `AgentOptions` runs first.

```typescript
api.on("transformContext", async (messages, signal) => {
  // Inject context, prune old messages, etc.
  return [systemInfoMessage, ...messages];
});
```

**BeforeToolCallHook** — Runs before each tool execution. Can block (with a custom result) or modify the tool call. Multiple hooks chain — first "block" wins.

```typescript
api.on("beforeToolCall", async (toolCall, tool) => {
  if (isDangerous(toolCall)) {
    return {
      action: "block",
      result: { content: [{ type: "text", text: "Blocked!" }], details: {} },
    };
  }
  // Optionally modify args
  return { action: "continue", toolCall: { ...toolCall, arguments: sanitized } };
});
```

**AfterToolResultHook** — Runs after each tool execution. Can modify the result message. Multiple hooks chain sequentially.

```typescript
api.on("afterToolResult", async (toolCall, result) => {
  return { ...result, content: [{ type: "text", text: redact(result) }] };
});
```

#### Typed Event Subscriptions

Instead of subscribing to all events and switching on `event.type`, you can subscribe to individual event types with full type safety:

```typescript
const myExtension: Extension = (api) => {
  // Typed — handler receives AgentStartEvent
  api.on("agent_start", (e) => {
    console.log("Agent loop started");
  });

  // Typed — handler receives TurnEndEvent
  api.on("turn_end", (e) => {
    console.log(`Turn finished with ${e.toolResults.length} tool results`);
  });

  // Typed — handler receives ToolExecStartEvent
  api.on("tool_execution_start", (e) => {
    console.log(`Executing ${e.toolName} with args:`, e.args);
  });

  // Typed — handler receives ToolExecEndEvent
  api.on("tool_execution_end", (e) => {
    if (e.isError) {
      console.error(`Tool ${e.toolName} failed`);
    }
  });
};
```

Available typed events:

| Event                    | Handler Type         | Payload                                           |
| ------------------------ | -------------------- | ------------------------------------------------- |
| `"agent_start"`          | `AgentStartEvent`    | `{ type }`                                        |
| `"agent_end"`            | `AgentEndEvent`      | `{ type, messages }`                              |
| `"turn_start"`           | `TurnStartEvent`     | `{ type }`                                        |
| `"turn_end"`             | `TurnEndEvent`       | `{ type, message, toolResults }`                  |
| `"message_start"`        | `MessageStartEvent`  | `{ type, message }`                               |
| `"message_end"`          | `MessageEndEvent`    | `{ type, message }`                               |
| `"tool_execution_start"` | `ToolExecStartEvent` | `{ type, toolCallId, toolName, args }`            |
| `"tool_execution_end"`   | `ToolExecEndEvent`   | `{ type, toolCallId, toolName, result, isError }` |

#### Input Hooks

Input hooks intercept user input _before_ it becomes a `UserMessage`. They can transform the text, handle it entirely (preventing the LLM from seeing it), or pass it through unchanged. Multiple input hooks chain sequentially.

```typescript
import type { Extension, InputHookResult } from "@agentik/agent";

const slashCommandHandler: Extension = (api) => {
  api.on("input", async (text, images): Promise<InputHookResult> => {
    // Handle slash commands directly, without sending to the LLM
    if (text.startsWith("/help")) {
      console.log("Available commands: /help, /clear, /model");
      return { action: "handled" };
    }

    // Transform input (e.g., expand shortcuts)
    if (text.startsWith("!fix")) {
      return {
        action: "transform",
        text: `Fix the following issue: ${text.slice(4).trim()}`,
        images,
      };
    }

    // Pass through unchanged
    return { action: "continue" };
  });
};
```

**InputHookResult** has three variants:

| Action        | Effect                                                         |
| ------------- | -------------------------------------------------------------- |
| `"continue"`  | Pass input through unchanged to the next hook (or to the LLM). |
| `"transform"` | Replace the text (and optionally images) for subsequent hooks. |
| `"handled"`   | Stop processing — the input is fully handled, no LLM call.     |

Input hooks run before the prompt is queued. If a hook returns `"handled"`, the `agent.prompt()` call returns immediately without starting the agent loop. Errors in individual hooks are caught and logged; the remaining hooks still run.

#### Active Tool Filtering

Extensions can dynamically control which tools are available to the LLM:

```typescript
const focusedMode: Extension = (api) => {
  // See all registered tool names
  const allTools = api.getActiveTools(); // ["bash", "read_file", "write_file", ...]

  // Restrict to read-only tools
  api.setActiveTools(["read_file", "glob", "grep", "ls"]);

  // Later, restore all tools
  return () => {
    api.setActiveTools(allTools);
  };
};
```

When `setActiveTools` is called, only the named tools are sent to the LLM on subsequent turns. Tools that are registered but not in the active set are hidden from the LLM but remain registered.

#### Sending Messages from Extensions

Extensions can inject messages into the conversation:

```typescript
const myExtension: Extension = (api) => {
  // Send a plain text user message as a follow-up
  api.sendUserMessage("Please also check for security issues.");

  // Send as a steering message (interrupts mid-run)
  api.sendUserMessage("Stop and focus on tests.", { deliverAs: "steer" });

  // Send rich content with images
  api.sendUserMessage([
    { type: "text", text: "Here's a screenshot:" },
    { type: "image", data: base64Data, mimeType: "image/png" },
  ]);
};
```

#### Runtime Model & Thinking Control

Extensions can change the model and thinking level dynamically:

```typescript
const adaptiveThinking: Extension = (api) => {
  api.on("turn_end", (e) => {
    // If the last turn used many tools, increase thinking
    if (e.toolResults.length > 3) {
      api.setThinkingLevel("high");
    }
  });

  api.on("agent_start", () => {
    // Reset to default at the start of each run
    api.setThinkingLevel("medium");
  });
};
```

### AI SDK Integration

Agentik uses AI SDK 6 under the hood. Key integration points:

- **Model**: Pass any AI SDK `LanguageModel` (from `@ai-sdk/anthropic`, `@ai-sdk/openai`, etc.)
- **Streaming**: Uses `streamText` from `ai` for real-time token streaming
- **Tools**: Converted to AI SDK tool format via `tool()` from `ai` with Zod `inputSchema`
- **Messages**: Converted from Agentik's `Message[]` to AI SDK's `ModelMessage[]` at the LLM call boundary

The agent loop manages the tool execution cycle itself (AI SDK's `maxSteps` / `stepCountIs` is not used). This gives full control over steering, follow-ups, and tool execution ordering.

---

## `@agentik/coding-agent` - Coding Tools & TUI

### Tools

The coding agent ships with 7 tools:

#### `bash` - Execute Shell Commands

Runs a bash command and returns stdout/stderr.

| Parameter | Type     | Required | Description                    |
| --------- | -------- | -------- | ------------------------------ |
| `command` | `string` | yes      | The bash command to execute    |
| `timeout` | `number` | no       | Timeout in ms (default: 30000) |

Returns: `{ exitCode: number }`

#### `read_file` - Read File Contents

Reads a file and returns contents with line numbers.

| Parameter | Type     | Required | Description                         |
| --------- | -------- | -------- | ----------------------------------- |
| `path`    | `string` | yes      | Path to the file                    |
| `offset`  | `number` | no       | Line number to start from (1-based) |
| `limit`   | `number` | no       | Max lines to read                   |

Returns: `{ lineCount: number }`

#### `write_file` - Write File Contents

Writes content to a file, creating parent directories as needed.

| Parameter | Type     | Required | Description      |
| --------- | -------- | -------- | ---------------- |
| `path`    | `string` | yes      | Path to the file |
| `content` | `string` | yes      | Content to write |

Returns: `{ bytesWritten: number }`

#### `edit` - Surgical Text Replacement

Replaces exact text in a file with fuzzy matching support. Key features:

- **Exact match first**: Tries exact string match before fuzzy
- **Fuzzy matching**: Normalizes smart quotes, Unicode dashes, trailing whitespace, and special spaces
- **Uniqueness enforcement**: Rejects edits when the search text matches multiple locations
- **BOM preservation**: UTF-8 BOM is preserved if present
- **CRLF preservation**: Original line endings are maintained
- **Diff output**: Returns a unified diff with line numbers

| Parameter | Type     | Required | Description                        |
| --------- | -------- | -------- | ---------------------------------- |
| `path`    | `string` | yes      | Path to the file                   |
| `oldText` | `string` | yes      | Text to find (must match uniquely) |
| `newText` | `string` | yes      | Replacement text                   |

Returns: `{ diff: string, firstChangedLine?: number }`

#### `glob` - Find Files by Pattern

Finds files matching a glob pattern using Bun's native `Glob`.

| Parameter | Type     | Required | Description                     |
| --------- | -------- | -------- | ------------------------------- |
| `pattern` | `string` | yes      | Glob pattern (e.g., `**/*.ts`)  |
| `cwd`     | `string` | no       | Search directory (default: cwd) |

Returns: `{ count: number }`

Safety limit: 1000 files max.

#### `grep` - Search File Contents

Searches file contents using [ripgrep](https://github.com/BurntSushi/ripgrep). Requires `rg` in PATH.

| Parameter    | Type      | Required | Description                                |
| ------------ | --------- | -------- | ------------------------------------------ |
| `pattern`    | `string`  | yes      | Regex or literal search pattern            |
| `path`       | `string`  | no       | Directory or file to search (default: cwd) |
| `glob`       | `string`  | no       | Filter files by glob (e.g., `*.ts`)        |
| `ignoreCase` | `boolean` | no       | Case-insensitive search                    |
| `literal`    | `boolean` | no       | Treat pattern as literal string            |
| `context`    | `number`  | no       | Lines of context around matches            |
| `limit`      | `number`  | no       | Max matches (default: 100)                 |

Returns: `{ matchLimitReached?: number, linesTruncated?: boolean }`

Features:

- Respects `.gitignore`
- Long lines truncated to 250 chars
- Output capped at 256KB
- Includes hidden files

#### `ls` - List Directory Contents

Lists directory entries with type indicators.

| Parameter | Type     | Required | Description                      |
| --------- | -------- | -------- | -------------------------------- |
| `path`    | `string` | no       | Directory to list (default: cwd) |
| `limit`   | `number` | no       | Max entries (default: 500)       |

Returns: `{ entryLimitReached?: number }`

Features:

- Directories suffixed with `/`
- Case-insensitive alphabetical sorting
- Includes dotfiles

### Using Tools Programmatically

```typescript
import { codingTools, bashTool, editTool, grepTool } from "@agentik/coding-agent";

// Use all 7 tools
const agent = new Agent({
  initialState: {
    model: myModel,
    tools: codingTools,
  },
});

// Or use individual tools
const result = await grepTool.execute("call-1", {
  pattern: "TODO",
  path: "./src",
  glob: "*.ts",
});
console.log(result.content[0].text);
```

### TUI

The included TUI (`cli.ts`) provides an interactive terminal built on `@opentui/core`:

```
agentik - coding agent
Model: anthropic/claude-sonnet-4-20250514
Tools: bash, read_file, write_file, edit, glob, grep, ls
Type /quit to exit

>
```

Commands:

- `/quit` or `/exit` - Exit
- `/clear` - Clear conversation history (starts a new session file)
- `/reset` - Full agent reset (starts a new session file)
- `/help` - List all available commands (including extension-registered commands)
- `/session` - Show model/token/session details
- `/export [file]` - Export current session to HTML (defaults to `<session-id>.html`)
- `/tools` - Show configured tools and parameter schema summary

Environment variables:

- `AGENTIK_PROVIDER` - `anthropic` (default) or `openai`
- `AGENTIK_MODEL` - Model ID (default: `claude-sonnet-4-20250514`)
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` - API credentials

Sessions are persisted as JSONL files under `~/.agentik/sessions/<encoded-cwd>/`.

### Built-in Extensions

The coding agent ships with 3 built-in extensions (all enabled by default in the TUI):

#### `bashGuard` — Command Safety

Blocks dangerous bash commands before they execute:

- `rm -rf /`, `rm -rf ~`, `rm -rf *`
- `git push --force` to main/master
- Fork bombs (`:(){ :|:& };:`)

```typescript
import { bashGuard } from "@agentik/coding-agent";
agent.use(bashGuard());
```

#### `toolLogger` — Execution Logging

Logs tool start/end events with duration tracking:

```typescript
import { toolLogger } from "@agentik/coding-agent";

// Default: logs to console
agent.use(toolLogger());

// Custom callback
agent.use(
  toolLogger({
    onLog: (entry) => {
      // entry: { type, toolName, toolCallId, args?, isError?, durationMs? }
      myLogger.info(entry);
    },
  })
);
```

#### `contextInfo` — Dynamic Context Injection

Injects working directory, git branch, and timestamp into the LLM context before each call:

```typescript
import { contextInfo } from "@agentik/coding-agent";
agent.use(contextInfo({ cwd: process.cwd() }));
```

---

## Writing Extensions

This section covers the full extension authoring experience for the coding-agent. Extensions have access to the `CodingExtensionAPI`, which includes everything from the core `ExtensionAPI` plus coding-agent-specific features: slash commands, keyboard shortcuts, CLI flags, UI primitives, an event bus, provider registration, and custom message rendering.

### File-Based Extension Loading

Extensions are TypeScript (or JavaScript) files that default-export a factory function. The coding-agent discovers and loads them automatically from two locations:

```
~/.agentik/extensions/         # Global extensions (shared across projects)
.agentik/extensions/           # Project-local extensions
```

#### Directory Layout

```
.agentik/extensions/
  my-tool.ts                   # Single-file extension
  analytics/
    index.ts                   # Multi-file extension (loaded via index.ts)
    helpers.ts
  notes.md                     # Ignored (not .ts or .js)
```

The loader scans one level deep:

- **Direct files**: `*.ts` and `*.js` files are loaded directly
- **Subdirectories**: Looks for `index.ts` (then `index.js` as fallback)
- **Non-code files**: `.md`, `.json`, etc. are ignored

#### Extension Factory

Every extension file must default-export a factory function:

```typescript
// .agentik/extensions/my-extension.ts
import type { CodingExtensionAPI } from "@agentik/coding-agent";

export default function myExtension(api: CodingExtensionAPI): void {
  // Register commands, shortcuts, hooks, tools, etc.
  api.registerCommand("greet", {
    description: "Say hello",
    handler: (args) => {
      api.ui.notify(`Hello, ${args || "world"}!`);
    },
  });
}
```

Factories can be async:

```typescript
export default async function (api: CodingExtensionAPI): Promise<void> {
  const config = await loadConfig();
  // ... use config
}
```

#### Error Isolation

Each extension loads in isolation. If one extension fails to load (syntax error, missing export, runtime error), the others still load successfully. Errors are reported but never crash the agent:

```typescript
import { discoverAndLoadExtensions } from "@agentik/coding-agent";

const { extensions, errors } = await discoverAndLoadExtensions(process.cwd());

for (const err of errors) {
  console.warn(`Failed to load ${err.path}: ${err.error}`);
}

for (const ext of extensions) {
  agent.use(ext.factory);
}
```

#### Programmatic Loading

You can also load extensions from explicit paths:

```typescript
import { loadExtensions, discoverExtensions } from "@agentik/coding-agent";

// Discover from standard locations
const paths = discoverExtensions(process.cwd());

// Load from explicit paths
const { extensions, errors } = await loadExtensions([
  "/path/to/my-extension.ts",
  "/path/to/another.ts",
]);

// Or combine: discover + extra paths
const result = await discoverAndLoadExtensions(process.cwd(), ["./custom/extra-ext.ts"]);
```

### CodingExtensionAPI

When loaded by the coding-agent, extensions receive a `CodingExtensionAPI` which extends the core `ExtensionAPI` with additional features:

```typescript
interface CodingExtensionAPI extends ExtensionAPI {
  // Everything from ExtensionAPI, plus:
  readonly ui: ExtensionUIContext;
  readonly events: EventBus;
  registerCommand(name, options): () => void;
  getCommands(): SlashCommandInfo[];
  registerShortcut(key, options): () => void;
  registerFlag(name, options): () => void;
  getFlag(name): boolean | string | undefined;
  registerProvider(name, config): () => void;
  registerMessageRenderer(customType, renderer): () => void;
  appendEntry(customType, data?): void;
}
```

Every `register*` method returns a cleanup function `() => void`. Call it to unregister the item.

### Slash Commands

Extensions can register slash commands that users invoke from the TUI input:

```typescript
export default function (api: CodingExtensionAPI) {
  api.registerCommand("model", {
    description: "Switch the active model",

    // Optional: provide argument completions
    getArgumentCompletions: (prefix) => {
      const models = ["claude-sonnet-4", "gpt-4o", "claude-haiku"];
      return models.filter((m) => m.startsWith(prefix)).map((m) => ({ value: m, label: m }));
    },

    handler: async (args, ctx) => {
      // args = everything after "/model "
      // ctx = { args } (same value, for forward compatibility)
      if (!args) {
        api.ui.notify("Usage: /model <model-name>", "warning");
        return;
      }
      api.ui.notify(`Switched to ${args}`);
    },
  });
}
```

Usage in the TUI:

```
> /model claude-sonnet-4
Switched to claude-sonnet-4

> /help
Available commands:
  /help — List available commands
  /model — Switch the active model
```

#### Command Registry API

```typescript
import { CommandRegistry, parseSlashCommand } from "@agentik/coding-agent";

const registry = new CommandRegistry(); // Includes built-in /help

// Register
const dispose = registry.register("deploy", {
  description: "Deploy to production",
  handler: async (args) => {
    /* ... */
  },
});

// Execute
const handled = await registry.execute("deploy", "--env staging");
// Returns true if command exists, false otherwise

// Autocomplete
const completions = registry.getCompletions("model", "cl");
// Returns [{ value: "claude-sonnet-4", label: "claude-sonnet-4" }, ...] or null

// List all commands
const commands = registry.listCommands();
// [{ name: "deploy", description: "Deploy to production", source: "extension" }, ...]

// Parse user input
parseSlashCommand("/model gpt-4"); // { name: "model", args: "gpt-4" }
parseSlashCommand("hello"); // null
parseSlashCommand("/"); // null

// Unregister
dispose();
```

### Keyboard Shortcuts

Extensions can register keyboard shortcuts for the TUI:

```typescript
export default function (api: CodingExtensionAPI) {
  api.registerShortcut("ctrl+k", {
    description: "Quick action menu",
    handler: async (ctx) => {
      // ctx.key === "ctrl+k"
      const choice = await api.ui.select("Quick Actions", [
        "Search files",
        "Run tests",
        "Open docs",
      ]);
      if (choice === "Run tests") {
        api.sendUserMessage("Run the test suite and report results.");
      }
    },
  });

  api.registerShortcut("f5", {
    description: "Refresh context",
    handler: () => {
      api.ui.notify("Context refreshed", "info");
    },
  });
}
```

#### Reserved Keys

The following keys are reserved by the TUI and cannot be overridden:

| Key           | Built-in Action      |
| ------------- | -------------------- |
| `ctrl+c`      | Interrupt / abort    |
| `ctrl+d`      | Exit                 |
| `ctrl+l`      | Clear screen         |
| `escape`      | Cancel current input |
| `enter`       | Submit input         |
| `shift+enter` | Newline in input     |
| `up` / `down` | History navigation   |
| `tab`         | Autocomplete         |
| `shift+tab`   | Reverse autocomplete |

Attempting to register a reserved key throws an error. Check before registering:

```typescript
import { ShortcutRegistry } from "@agentik/coding-agent";

if (!ShortcutRegistry.isReserved("ctrl+k")) {
  api.registerShortcut("ctrl+k", {
    handler: () => {
      /* ... */
    },
  });
}
```

#### Key Normalization

Key identifiers are case-insensitive: `"Ctrl+K"`, `"ctrl+k"`, and `"CTRL+K"` all refer to the same shortcut.

#### Shortcut Registry API

```typescript
import { ShortcutRegistry } from "@agentik/coding-agent";

const registry = new ShortcutRegistry();

// Register
const dispose = registry.register("ctrl+k", {
  description: "Quick action",
  handler: async (ctx) => {
    /* ... */
  },
});

// Execute
const handled = await registry.execute("ctrl+k"); // true
const missed = await registry.execute("ctrl+x"); // false

// Errors in handlers are caught internally — execute still returns true
registry.register("f2", {
  handler: () => {
    throw new Error("oops");
  },
});
await registry.execute("f2"); // true (error logged, not thrown)

// List
const shortcuts = registry.listShortcuts();
// [{ key: "ctrl+k", description: "Quick action", handler: fn }, ...]

// Unregister
dispose();
```

### CLI Flags

Extensions can register CLI flags that users pass when starting the agent:

```typescript
export default function (api: CodingExtensionAPI) {
  // Boolean flag
  api.registerFlag("verbose", {
    description: "Enable verbose output",
    type: "boolean",
    default: false,
  });

  // String flag
  api.registerFlag("output-format", {
    description: "Output format (json, text, markdown)",
    type: "string",
    default: "text",
  });

  // Read flag values later
  api.on("agent_start", () => {
    if (api.getFlag("verbose")) {
      console.log("Verbose mode enabled");
    }
    const format = api.getFlag("output-format"); // "text" (or CLI override)
  });
}
```

Usage from the command line:

```bash
# Boolean flags
bun run cli.ts --verbose

# String flags
bun run cli.ts --output-format=json

# Boolean flags with explicit values
bun run cli.ts --verbose=true
bun run cli.ts --verbose=false
```

#### Flag Registry API

```typescript
import { FlagRegistry } from "@agentik/coding-agent";

const flags = new FlagRegistry();

// Register flags
flags.register("debug", { type: "boolean", default: false });
flags.register("theme", { type: "string", default: "dark" });

// Read values
flags.get("debug"); // false (default)
flags.get("theme"); // "dark" (default)
flags.get("unknown"); // undefined

// Set values programmatically
flags.set("debug", true);

// Apply CLI arguments (unknown flags are silently ignored)
flags.applyCliArgs(["--debug", "--theme=light", "--unknown-flag"]);
flags.get("debug"); // true
flags.get("theme"); // "light"

// List all flags
const allFlags = flags.listFlags();
// [{ name: "debug", type: "boolean", default: false }, ...]
```

### UI Primitives

Extensions can present interactive UI elements to the user through the `api.ui` context:

```typescript
export default function (api: CodingExtensionAPI) {
  api.registerCommand("config", {
    description: "Configure settings",
    handler: async () => {
      // Selection dialog
      const theme = await api.ui.select("Choose theme", ["Dark", "Light", "System"]);

      // Confirmation dialog
      const confirmed = await api.ui.confirm("Apply Theme", `Switch to ${theme} theme?`);
      if (!confirmed) return;

      // Text input dialog
      const name = await api.ui.input("Display Name", "Enter your name");

      // Notifications
      api.ui.notify(`Theme set to ${theme}`, "info");
      api.ui.notify("Config saved!", "info");

      // Status bar
      api.ui.setStatus("theme", `Theme: ${theme}`);

      // Widget display
      api.ui.setWidget("config", [`Name: ${name}`, `Theme: ${theme}`]);

      // Terminal title
      api.ui.setTitle(`Agentik - ${name}`);
    },
  });
}
```

#### ExtensionUIContext Interface

| Method                               | Returns                        | Description                                       |
| ------------------------------------ | ------------------------------ | ------------------------------------------------- |
| `select(title, options, opts?)`      | `Promise<string \| undefined>` | Show a selector with choices.                     |
| `confirm(title, message, opts?)`     | `Promise<boolean>`             | Show a yes/no confirmation dialog.                |
| `input(title, placeholder?, opts?)`  | `Promise<string \| undefined>` | Show a text input prompt.                         |
| `notify(message, type?)`             | `void`                         | Show a notification (`info`, `warning`, `error`). |
| `setStatus(key, text \| undefined)`  | `void`                         | Set/clear a status bar entry.                     |
| `setWidget(key, lines \| undefined)` | `void`                         | Set/clear a widget display.                       |
| `setTitle(title)`                    | `void`                         | Set the terminal window title.                    |

All dialog methods accept an optional `opts` parameter with `signal?: AbortSignal` and `timeout?: number` for cancellation.

#### NoopUIContext

For headless or testing scenarios, `NoopUIContext` provides a no-op implementation where all dialogs resolve immediately with default values:

```typescript
import { NoopUIContext } from "@agentik/coding-agent";

const ui = new NoopUIContext();
await ui.select("Pick one", ["a", "b"]); // undefined
await ui.confirm("Sure?", "Really?"); // false
await ui.input("Name?"); // undefined
ui.notify("Hello"); // no-op
```

### Event Bus

The event bus enables inter-extension communication without direct dependencies. Extensions publish and subscribe on named channels:

```typescript
export default function analyticsExtension(api: CodingExtensionAPI) {
  // Subscribe to events from other extensions
  const unsub = api.events.on("file:saved", (data) => {
    const { path, size } = data as { path: string; size: number };
    console.log(`File saved: ${path} (${size} bytes)`);
  });

  // Publish events for other extensions to consume
  api.on("tool_execution_end", (e) => {
    if (e.toolName === "write_file") {
      api.events.emit("file:saved", {
        path: (e.result as { path: string }).path,
        size: 0,
      });
    }
  });
}
```

Another extension can listen:

```typescript
export default function notifierExtension(api: CodingExtensionAPI) {
  api.events.on("file:saved", (data) => {
    const { path } = data as { path: string };
    api.ui.notify(`Saved: ${path}`, "info");
  });
}
```

#### EventBus API

```typescript
import { createEventBus } from "@agentik/coding-agent";

const bus = createEventBus();

// Subscribe — returns unsubscribe function
const unsub = bus.on("my-channel", (data) => {
  console.log("Received:", data);
});

// Emit
bus.emit("my-channel", { key: "value" }); // logs: Received: { key: "value" }

// Unsubscribe
unsub();
bus.emit("my-channel", { key: "value" }); // nothing happens

// Clear all handlers
bus.clear();
```

**Error isolation**: Handlers that throw are caught and logged. Other handlers on the same channel still run. Async handlers that reject are also caught.

### Provider Registration

Extensions can register custom LLM providers (useful for self-hosted models, proxies, or specialized APIs):

```typescript
export default function (api: CodingExtensionAPI) {
  api.registerProvider("my-company", {
    baseUrl: "https://llm.internal.company.com/v1",
    apiKey: process.env.INTERNAL_LLM_KEY,
    headers: {
      "X-Team": "engineering",
    },
    models: [
      {
        name: "internal-7b",
        displayName: "Internal 7B",
        maxTokens: 4096,
        supportsThinking: false,
      },
      {
        name: "internal-70b",
        displayName: "Internal 70B",
        maxTokens: 8192,
        supportsThinking: true,
      },
    ],
  });
}
```

#### ProviderConfig

| Field     | Type                      | Description                          |
| --------- | ------------------------- | ------------------------------------ |
| `baseUrl` | `string?`                 | API base URL.                        |
| `apiKey`  | `string?`                 | Authentication key.                  |
| `models`  | `ModelConfig[]?`          | Available models from this provider. |
| `headers` | `Record<string, string>?` | Extra headers for API requests.      |

#### ModelConfig

| Field              | Type       | Description                                    |
| ------------------ | ---------- | ---------------------------------------------- |
| `name`             | `string`   | Model identifier (e.g., `"gpt-4o"`).           |
| `displayName`      | `string?`  | Human-readable name.                           |
| `maxTokens`        | `number?`  | Maximum output tokens.                         |
| `supportsThinking` | `boolean?` | Whether the model supports thinking/reasoning. |

### Custom Message Rendering

Extensions can define custom message types with custom renderers. Custom messages are stored in the session but not sent to the LLM:

```typescript
export default function (api: CodingExtensionAPI) {
  // Register a renderer for "deploy-status" messages
  api.registerMessageRenderer<{ env: string; status: string }>(
    "deploy-status",
    (message, options) => {
      const { env, status } = message.details!;
      if (options.expanded) {
        return [`Deploy to ${env}: ${status}`, `Timestamp: ${new Date().toISOString()}`];
      }
      return [`Deploy: ${env} - ${status}`];
    }
  );

  // Append a custom entry to the session
  api.appendEntry("deploy-status", {
    env: "production",
    status: "success",
  });
}
```

#### MessageRendererFn

```typescript
type MessageRendererFn<T = unknown> = (
  message: CustomMessageData<T>,
  options: MessageRenderOptions
) => string[] | undefined;
```

- `message.customType`: The type string you registered
- `message.content`: Optional string content
- `message.details`: Your typed data payload
- `options.expanded`: Whether the UI wants a full or compact view
- Return `string[]` (lines to display) or `undefined` (skip rendering)

### Complete Extension Example

Here's a full extension that combines multiple features:

```typescript
// .agentik/extensions/git-helper.ts
import type { CodingExtensionAPI } from "@agentik/coding-agent";

export default function gitHelper(api: CodingExtensionAPI): void {
  // Register a CLI flag
  api.registerFlag("auto-commit", {
    description: "Automatically commit after successful edits",
    type: "boolean",
    default: false,
  });

  // Register a slash command
  api.registerCommand("commit", {
    description: "Create a git commit with AI-generated message",
    handler: async (args) => {
      const message = args || "Auto-generated commit";
      const confirmed = await api.ui.confirm("Commit", `Create commit: "${message}"?`);
      if (confirmed) {
        api.sendUserMessage(`Run: git add -A && git commit -m "${message}"`);
      }
    },
  });

  // Register a keyboard shortcut
  api.registerShortcut("ctrl+g", {
    description: "Git status",
    handler: () => {
      api.sendUserMessage("Show me the git status and recent log.");
    },
  });

  // Track file changes via the event bus
  api.events.on("file:changed", (data) => {
    const { path } = data as { path: string };
    api.ui.setStatus("git", `Modified: ${path}`);
  });

  // Monitor tool execution for file writes
  api.on("tool_execution_end", (e) => {
    if (e.toolName === "write_file" || e.toolName === "edit") {
      api.events.emit("file:changed", { path: "unknown" });

      if (api.getFlag("auto-commit")) {
        api.sendUserMessage("Please commit the changes you just made.");
      }
    }
  });

  // Set up thinking based on task complexity
  api.on("turn_start", () => {
    const tools = api.getActiveTools();
    if (tools.includes("bash")) {
      api.setThinkingLevel("medium");
    }
  });

  // Intercept input for git shortcuts
  api.on("input", (text) => {
    if (text === "gs") {
      return { action: "transform", text: "Show the git status." };
    }
    if (text === "gl") {
      return { action: "transform", text: "Show the last 5 git log entries." };
    }
    return { action: "continue" };
  });
}
```

---

## Development

### Scripts

```bash
bun run build          # TypeScript build (tsc -b)
bun run typecheck      # Type check without emit
bun run lint           # oxlint with type-aware rules
bun run lint:fix       # Auto-fix lint issues
bun run format         # Format with oxfmt
bun run format:check   # Check formatting
bun run knip           # Check for unused deps/exports
bun test               # Build + run all tests
bun run clean          # Remove dist directories
```

### Pre-commit Hooks

Lefthook runs these checks on every commit:

- **format** - oxfmt formatting
- **knip** - Unused dependency/export detection
- **lint** - oxlint with type-aware rules
- **typecheck** - TypeScript compilation

### Project Structure

```
packages/
  agent/
    src/
      agent.ts          # Agent class (stateful wrapper)
      agent-loop.ts     # Core loop (agentLoop / agentLoopContinue)
      event-stream.ts   # EventStream async iterable
      types.ts          # All type definitions
      index.ts          # Public API exports
    test/
      agent.test.ts
      agent-loop.test.ts
      event-stream.test.ts
      extension.test.ts       # Core extension system tests
      extension-new.test.ts   # Typed events, input hooks, active tools
      utils/
        mock-model.ts   # Mock AI SDK LanguageModel for tests
        echo-tool.ts    # Simple echo tool for tests
  coding-agent/
    src/
      cli.ts            # TUI entry point
      commands/
        types.ts        # Command type definitions
        registry.ts     # CommandRegistry + parseSlashCommand
        index.ts        # Command exports
      tools/
        bash.ts         # Shell command execution
        read-file.ts    # File reading with line numbers
        write-file.ts   # File writing with mkdir -p
        edit.ts         # Surgical text replacement with fuzzy matching
        glob.ts         # Bun-native file glob
        grep.ts         # ripgrep-powered content search
        ls.ts           # Directory listing
        index.ts        # Tool exports + codingTools array
      extensions/
        bash-guard.ts           # Blocks dangerous bash commands
        tool-logger.ts          # Logs tool execution with timing
        context-info.ts         # Injects cwd, git branch, timestamp
        loader.ts               # Extension discovery and loading
        flags.ts                # FlagRegistry for CLI flags
        shortcuts.ts            # ShortcutRegistry for keyboard shortcuts
        ui-context.ts           # ExtensionUIContext + NoopUIContext
        event-bus.ts            # EventBus for inter-extension communication
        providers.ts            # ProviderRegistry for custom LLM providers
        message-renderer.ts     # MessageRendererRegistry for custom messages
        coding-extension-api.ts # CodingExtensionAPI factory
        index.ts                # Extension exports
      tui/
        app.ts          # TuiApp main class
        theme.ts        # Tokyonight color scheme
      index.ts          # Package public API
    test/
      tools.test.ts              # 27 tests for all coding tools
      extensions.test.ts         # Built-in extension integration tests
      commands.test.ts           # CommandRegistry + parseSlashCommand tests
      flags.test.ts              # FlagRegistry tests
      shortcuts.test.ts          # ShortcutRegistry tests
      event-bus.test.ts          # EventBus tests
      extension-loader.test.ts   # Extension discovery + loading tests
      ui-context.test.ts         # NoopUIContext tests
      providers.test.ts          # ProviderRegistry tests
      message-renderer.test.ts   # MessageRendererRegistry tests
      coding-extension-api.test.ts # CodingExtensionAPI integration tests
```

### Testing

Tests use `bun:test` with a mock `LanguageModel` that simulates AI SDK responses:

```typescript
import { createMockModel } from "./utils/mock-model.js";

// Simulate a text-only response
const model = createMockModel([{ text: "Hello!" }]);

// Simulate a response with tool calls
const model = createMockModel([
  { toolCalls: [{ name: "bash", input: { command: "ls" } }] },
  { text: "Here are the files." },
]);
```

The mock model produces the same stream events as a real AI SDK model, enabling full integration testing of the agent loop without API calls.

---

## API Reference

### `@agentik/agent` Exports

**Classes**

- `Agent` — Stateful agent with event subscriptions and message queuing
- `EventStream` — Generic async iterable for streaming events

**Functions**

- `agentLoop(messages, context, config, signal?)` — Start a new agent loop
- `agentLoopContinue(context, config, signal?)` — Resume from existing context

**Types — Messages**

- `AgentMessage`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`
- `Message`, `CustomAgentMessages`, `TextContent`, `ImageContent`, `ThinkingContent`, `ToolCall`
- `Usage`, `StopReason`

**Types — Events**

- `AgentEvent`, `AssistantMessageEvent`
- `AgentStartEvent`, `AgentEndEvent`, `TurnStartEvent`, `TurnEndEvent`
- `MessageStartEvent`, `MessageEndEvent`, `ToolExecStartEvent`, `ToolExecEndEvent`

**Types — Extensions**

- `Extension`, `ExtensionAPI`
- `TransformContextHook`, `BeforeToolCallHook`, `AfterToolResultHook`
- `InputHook`, `InputHookResult`

**Types — Config**

- `AgentOptions`, `AgentLoopConfig`, `AgentContext`, `AgentState`
- `AgentTool`, `AgentToolResult`, `AgentToolUpdateCallback`
- `ThinkingLevel`, `ThinkingBudgets`

### `@agentik/coding-agent` Exports

**Tools**

- `codingTools` — Array of all 7 tools
- `bashTool`, `readFileTool`, `writeFileTool`, `editTool`, `globTool`, `grepTool`, `lsTool`

**Built-in Extensions**

- `bashGuard()`, `toolLogger(options?)`, `contextInfo(options?)`

**Extension Loader**

- `discoverExtensions(cwd)` — Find extension files in standard locations
- `loadExtensions(paths)` — Load extensions from file paths
- `discoverAndLoadExtensions(cwd, extraPaths?)` — Discover + load in one call

**Registries**

- `CommandRegistry` — Slash command registration and dispatch
- `ShortcutRegistry` — Keyboard shortcut registration
- `FlagRegistry` — CLI flag registration and parsing
- `ProviderRegistry` — Custom LLM provider registration
- `MessageRendererRegistry` — Custom message type renderers

**Utilities**

- `parseSlashCommand(input)` — Parse `/name args` format
- `createEventBus()` — Create an event bus instance
- `createCodingExtensionAPI(options)` — Create a CodingExtensionAPI wrapper
- `NoopUIContext` — No-op UI implementation for headless mode

**Types**

- `CodingExtensionAPI`, `CodingExtensionAPIOptions`
- `ExtensionFactory`, `LoadedExtension`, `LoadExtensionsResult`
- `RegisteredCommand`, `SlashCommandInfo`, `SlashCommandSource`, `ParsedSlashCommand`, `AutocompleteItem`, `CommandContext`
- `RegisteredShortcut`, `ShortcutContext`
- `FlagDefinition`
- `ExtensionUIContext`, `UIDialogOptions`
- `EventBus`, `EventBusController`
- `ProviderConfig`, `ModelConfig`, `RegisteredProvider`
- `CustomMessageData`, `MessageRendererFn`, `MessageRenderOptions`
- `ToolLogEntry`, `ToolLoggerOptions`, `ContextInfoOptions`

---

## License

MIT
