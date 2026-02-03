#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/release-cli.sh <version> [--no-push]

Examples:
  scripts/release-cli.sh 0.1.0
  scripts/release-cli.sh cli-v0.1.0 --no-push

Notes:
  - Creates an annotated tag "cli-v<version>" (or uses the provided tag if it
    already starts with "cli-v").
  - Pushes the tag to the "origin" remote by default.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

version="${1:-}"
if [ -z "$version" ]; then
  usage >&2
  exit 1
fi

push_tag="true"
if [ "${2:-}" = "--no-push" ]; then
  push_tag="false"
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This script must be run inside a git repository." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty. Commit or stash changes before tagging." >&2
  exit 1
fi

if [[ "$version" == cli-v* ]]; then
  tag="$version"
else
  tag="cli-v${version}"
fi

if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "Tag ${tag} already exists." >&2
  exit 1
fi

git tag -a "$tag" -m "CLI release ${tag}"
echo "Created tag ${tag}."

if [ "$push_tag" = "true" ]; then
  if git remote get-url origin >/dev/null 2>&1; then
    git push origin "$tag"
    echo "Pushed ${tag} to origin."
  else
    echo "Remote 'origin' not found. Push the tag manually with:"
    echo "  git push <remote> ${tag}"
  fi
fi
