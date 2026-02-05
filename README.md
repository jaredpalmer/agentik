# Agentik

A modular, streaming-first AI agent framework built on [AI SDK 6](https://sdk.vercel.ai/). Designed for building coding agents and tool-using LLM applications with full control over the conversation loop.

## Architecture

```
agentik/
  packages/
    agent/          # @agentik/agent - core agent loop, types, state management
    coding-agent/   # @agentik/coding-agent - 7 coding tools + minimal TUI
```

Agentik is a Bun monorepo with two packages:

- **`@agentik/agent`** is the core library. It provides the agent loop, streaming event system, message types, and stateful `Agent` class. It depends only on `ai` (AI SDK 6) and `zod`.
- **`@agentik/coding-agent`** is a concrete agent with 7 coding tools (bash, read, write, edit, glob, grep, ls) and a minimal terminal UI for interactive testing.

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

This builds the project and runs all 53 tests across both packages.

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

The included TUI (`cli.ts`) provides a minimal interactive terminal for testing:

```
agentik - coding agent
Model: anthropic/claude-sonnet-4-20250514
Tools: bash, read_file, write_file, edit, glob, grep, ls
Type /quit to exit

>
```

Commands:

- `/quit` or `/exit` - Exit
- `/clear` - Clear conversation history
- `/reset` - Full agent reset

Environment variables:

- `AGENTIK_PROVIDER` - `anthropic` (default) or `openai`
- `AGENTIK_MODEL` - Model ID (default: `claude-sonnet-4-20250514`)
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` - API credentials

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
      utils/
        mock-model.ts   # Mock AI SDK LanguageModel for tests
        echo-tool.ts    # Simple echo tool for tests
  coding-agent/
    src/
      cli.ts            # Minimal TUI
      tools/
        bash.ts         # Shell command execution
        read-file.ts    # File reading with line numbers
        write-file.ts   # File writing with mkdir -p
        edit.ts         # Surgical text replacement with fuzzy matching
        glob.ts         # Bun-native file glob
        grep.ts         # ripgrep-powered content search
        ls.ts           # Directory listing
        index.ts        # Tool exports + codingTools array
      index.ts          # Package public API
    test/
      tools.test.ts     # 27 tests for all coding tools
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

## License

MIT
