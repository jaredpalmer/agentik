#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

NOW="$(date "+%Y-%m-%d %H:%M:%S %z")"

append_session() {
  printf "%s\n" "$1" >> "$ROOT/session.txt"
}

printf "== Agentik Coding Agent Resume Context ==\n"
printf "Time: %s\n" "$NOW"
printf "\n"
printf "Key files:\n"
printf "%s\n" "- PLAN.md"
printf "%s\n" "- features.json"
printf "%s\n" "- session.txt"
printf "\n"
printf "IMPORTANT: session.txt can be mined for context and history of work that's been done.\n"
printf "\n"

printf "== Git Status ==\n"
git status -sb

printf "\n== Recent Commits (for subagent context) ==\n"
# Capture recent history for future subagent context
RECENT_LOG="$(git log --oneline -n 30)"
printf "%s\n" "$RECENT_LOG"

printf "\n== Plan Summary ==\n"
if [[ -f PLAN.md ]]; then
  sed -n '1,120p' PLAN.md
else
  printf "PLAN.md not found.\n"
fi

printf "\n== Feature Status ==\n"
if [[ -f features.json ]]; then
  # Print feature ids + status without requiring jq
  rg -n '"id"|"status"' features.json || true
else
  printf "features.json not found.\n"
fi

printf "\n== Session Log (tail) ==\n"
if [[ -f session.txt ]]; then
  tail -n 40 session.txt
else
  printf "session.txt not found.\n"
fi

# Append to session log
append_session ""
append_session "$NOW"
append_session "- Ran init.sh to restore context."
append_session "- Git status: $(git status -sb | head -n 1)"
append_session "- Recent commits (for subagent context):"
append_session "$RECENT_LOG"
append_session "- Note: session.txt can be mined for context and history of work done."
