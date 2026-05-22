#!/bin/sh
# Install Cursor Agent CLI using the official installer (same as cursor.com/docs).
# Leaves the native layout under $HOME/.local/bin and $HOME/.local/share/cursor-agent.
# Do not copy or relocate the wrapper — it must stay beside its version directory.
set -eu

export HOME="${PAPERCLIP_HOME:-${HOME:-/root}}"
mkdir -p "$HOME"

echo "Installing Cursor Agent CLI (HOME=${HOME})..."
curl -fsSL https://cursor.com/install | bash

export PATH="${HOME}/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"

for cmd in agent cursor-agent; do
  if command -v "$cmd" >/dev/null 2>&1; then
    resolved="$(command -v "$cmd")"
    version="$("$cmd" --version 2>/dev/null || true)"
    echo "Cursor Agent CLI ready: ${resolved}${version:+ (${version})}}"
    exit 0
  fi
done

echo "ERROR: Cursor install finished but agent is not on PATH (${HOME}/.local/bin)." >&2
exit 1
