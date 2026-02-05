# YAML Frontmatter Schema

**See `.claude/skills/compound-docs/schema.yaml` for the complete schema specification.**

## Required Fields

- **module** (string): Module name (e.g., "Agent Loop", "Event Stream") or "System" for system-wide issues
- **date** (string): ISO 8601 date (YYYY-MM-DD)
- **problem_type** (enum): One of [build_error, test_failure, runtime_error, type_error, streaming_issue, tool_execution_issue, ai_sdk_integration, performance_issue, config_error, dependency_issue, logic_error, developer_experience, documentation_gap]
- **component** (enum): One of [agent_loop, agent_class, event_stream, type_system, message_conversion, tool_bash, tool_edit, tool_grep, tool_file_io, ai_sdk_stream, provider_config, zod_schemas, cli_tui, build_tooling, testing]
- **symptoms** (array): 1-5 specific observable symptoms
- **root_cause** (enum): One of [type_mismatch, missing_type_assertion, declaration_merge_error, zod_schema_error, ai_sdk_api_change, stream_event_ordering, async_timing, abort_signal_handling, subprocess_error, config_error, logic_error, message_format_error, missing_null_check, encoding_issue, workspace_resolution, dependency_version_mismatch]
- **resolution_type** (enum): One of [code_fix, type_fix, config_change, test_fix, dependency_update, schema_fix, environment_setup, documentation_update, tooling_addition]
- **severity** (enum): One of [critical, high, medium, low]

## Optional Fields

- **bun_version** (string): Bun version in X.Y.Z format
- **ai_sdk_version** (string): AI SDK version in X.Y.Z format
- **package** (string): Which package was affected (e.g., "@agentik/agent")
- **tags** (array): Searchable keywords (lowercase, hyphen-separated)

## Validation Rules

1. All required fields must be present
2. Enum fields must match allowed values exactly (case-sensitive)
3. symptoms must be YAML array with 1-5 items
4. date must match YYYY-MM-DD format
5. bun_version (if provided) must match X.Y.Z format
6. ai_sdk_version (if provided) must match X.Y.Z format
7. tags should be lowercase, hyphen-separated

## Example

```yaml
---
module: Agent Loop
date: 2025-12-01
problem_type: streaming_issue
component: ai_sdk_stream
symptoms:
  - "streamText tool-result events arriving before tool-call events"
  - "Agent loop processes stale tool results"
root_cause: stream_event_ordering
ai_sdk_version: 6.0.72
package: "@agentik/agent"
resolution_type: code_fix
severity: high
tags: [stream-event, tool-call, ordering]
---
```

## Category Mapping

Based on `problem_type`, documentation is filed in:

- **build_error** → `docs/solutions/build-errors/`
- **test_failure** → `docs/solutions/test-failures/`
- **runtime_error** → `docs/solutions/runtime-errors/`
- **type_error** → `docs/solutions/type-errors/`
- **streaming_issue** → `docs/solutions/streaming-issues/`
- **tool_execution_issue** → `docs/solutions/tool-issues/`
- **ai_sdk_integration** → `docs/solutions/ai-sdk-issues/`
- **performance_issue** → `docs/solutions/performance-issues/`
- **config_error** → `docs/solutions/config-errors/`
- **dependency_issue** → `docs/solutions/dependency-issues/`
- **logic_error** → `docs/solutions/logic-errors/`
- **developer_experience** → `docs/solutions/developer-experience/`
- **documentation_gap** → `docs/solutions/documentation-gaps/`
