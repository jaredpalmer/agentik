#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="jaredpalmer/agentik"
REPO="${AGENTIK_REPO:-${GITHUB_REPOSITORY:-$DEFAULT_REPO}}"
VERSION="${AGENTIK_VERSION:-latest}"
INSTALL_DIR="${AGENTIK_INSTALL_DIR:-$HOME/.local/bin}"
BINARY_NAME="agentik"

if [ -z "$REPO" ]; then
  echo "AGENTIK_REPO is required (format: owner/repo)." >&2
  exit 1
fi

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  MINGW*|MSYS*|CYGWIN*) os="windows" ;;
  *)
    echo "Unsupported OS: $os" >&2
    exit 1
    ;;
esac

case "$arch" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *)
    echo "Unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

asset="${BINARY_NAME}-${os}-${arch}"
if [ "$os" = "windows" ]; then
  asset="${asset}.exe"
fi

download() {
  local url="$1"
  local dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
    return
  fi
  echo "curl or wget is required to download binaries." >&2
  exit 1
}

get_latest_tag() {
  local api="https://api.github.com/repos/${REPO}/releases/latest"
  local tmp
  local tag
  tmp="$(mktemp)"
  download "$api" "$tmp"
  tag="$(grep -m1 '"tag_name"' "$tmp" | sed -E 's/.*"([^"]+)".*/\\1/')"
  rm -f "$tmp"
  if [ -z "$tag" ]; then
    echo "Unable to resolve latest release tag for ${REPO}." >&2
    exit 1
  fi
  echo "$tag"
}

if [ "$VERSION" = "latest" ]; then
  VERSION="$(get_latest_tag)"
fi

url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
tmp="$(mktemp)"

echo "Downloading ${asset} from ${REPO} (${VERSION})..."
download "$url" "$tmp"

chmod +x "$tmp"
mkdir -p "$INSTALL_DIR"
mv "$tmp" "${INSTALL_DIR}/${BINARY_NAME}"

echo "Installed ${BINARY_NAME} to ${INSTALL_DIR}/${BINARY_NAME}"

case ":$PATH:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo "Add ${INSTALL_DIR} to your PATH to run '${BINARY_NAME}'."
    ;;
esac
