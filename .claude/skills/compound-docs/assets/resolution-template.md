---
module: [Module name or "System" for system-wide]
date: [YYYY-MM-DD]
problem_type:
  [
    build_error|test_failure|runtime_error|type_error|streaming_issue|tool_execution_issue|ai_sdk_integration|performance_issue|config_error|dependency_issue|logic_error|developer_experience|documentation_gap,
  ]
component:
  [
    agent_loop|agent_class|event_stream|type_system|message_conversion|tool_bash|tool_edit|tool_grep|tool_file_io|ai_sdk_stream|provider_config|zod_schemas|cli_tui|build_tooling|testing,
  ]
symptoms:
  - [Observable symptom 1 - specific error message or behavior]
  - [Observable symptom 2 - what user actually saw/experienced]
root_cause:
  [
    type_mismatch|missing_type_assertion|declaration_merge_error|zod_schema_error|ai_sdk_api_change|stream_event_ordering|async_timing|abort_signal_handling|subprocess_error|config_error|logic_error|message_format_error|missing_null_check|encoding_issue|workspace_resolution|dependency_version_mismatch,
  ]
resolution_type: [code_fix|type_fix|config_change|test_fix|dependency_update|schema_fix|environment_setup|documentation_update|tooling_addition]
severity: [critical|high|medium|low]
ai_sdk_version: [6.0.72 - optional]
bun_version: [1.2.4 - optional]
package: ["@agentik/agent" - optional]
tags: [keyword1, keyword2, keyword3]
---

# Troubleshooting: [Clear Problem Title]

## Problem

[1-2 sentence clear description of the issue and what the user experienced]

## Environment

- Module: [Name or "System-wide"]
- Package: [e.g., "@agentik/agent", "@agentik/coding-agent"]
- Bun Version: [e.g., 1.2.4]
- AI SDK Version: [e.g., 6.0.72]
- TypeScript Version: [e.g., 5.7.3]
- Affected Component: [e.g., "Agent Loop streamText call", "Edit tool fuzzy matching", "Event stream emission"]
- Date: [YYYY-MM-DD when this was solved]

## Symptoms

- [Observable symptom 1 - what the user saw/experienced]
- [Observable symptom 2 - error messages, visual issues, unexpected behavior]
- [Continue as needed - be specific]

## What Didn't Work

**Attempted Solution 1:** [Description of what was tried]

- **Why it failed:** [Technical reason this didn't solve the problem]

**Attempted Solution 2:** [Description of second attempt]

- **Why it failed:** [Technical reason]

[Continue for all significant attempts that DIDN'T work]

[If nothing else was attempted first, write:]
**Direct solution:** The problem was identified and fixed on the first attempt.

## Solution

[The actual fix that worked - provide specific details]

**Code changes** (if applicable):

```typescript
// Before (broken):
[Show the problematic code]

// After (fixed):
[Show the corrected code with explanation]
```

**Commands run** (if applicable):

```bash
# Steps taken to fix:
[Commands or actions]
```

## Why This Works

[Technical explanation of:]

1. What was the ROOT CAUSE of the problem?
2. Why does the solution address this root cause?
3. What was the underlying issue (type mismatch, API misuse, configuration error, etc.)?

[Be detailed enough that future developers understand the "why", not just the "what"]

## Prevention

[How to avoid this problem in future development:]

- [Specific coding practice, check, or pattern to follow]
- [What to watch out for]
- [How to catch this early]

## Related Issues

[If any similar problems exist in docs/solutions/, link to them:]

- See also: [another-related-issue.md](../category/another-related-issue.md)
- Similar to: [related-problem.md](../category/related-problem.md)

[If no related issues, write:]
No related issues documented yet.
