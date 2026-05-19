#!/bin/sh
# Install Cursor Agent CLI and place executables on a global PATH (for Paperclip adapters).
set -eu

echo "Installing Cursor Agent CLI..."
export HOME="${HOME:-/root}"
curl -fsSL https://cursor.com/install | bash

find_cursor_agent_binary() {
  for candidate in \
    /root/.local/bin/agent \
    /root/.local/bin/cursor-agent \
    "${HOME:-/root}/.local/bin/agent" \
    "${HOME:-/root}/.local/bin/cursor-agent" \
    /paperclip/.local/bin/agent \
    /paperclip/.local/bin/cursor-agent \
    /home/node/.local/bin/agent \
    /home/node/.local/bin/cursor-agent
  do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

AGENT_BIN="$(find_cursor_agent_binary)" || {
  echo "ERROR: Cursor Agent CLI install finished but no executable was found." >&2
  echo "Checked ~/.local/bin under root, node, and /paperclip." >&2
  exit 1
}

echo "Found Cursor Agent CLI at: ${AGENT_BIN}"
install -m 755 "$AGENT_BIN" /usr/local/bin/agent

if [ "$(basename "$AGENT_BIN")" = "cursor-agent" ]; then
  ln -sf agent /usr/local/bin/cursor-agent
else
  OTHER="${AGENT_BIN%/*}/cursor-agent"
  if [ -x "$OTHER" ]; then
    install -m 755 "$OTHER" /usr/local/bin/cursor-agent
  else
    ln -sf agent /usr/local/bin/cursor-agent
  fi
fi

export PATH="/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if ! test -x /usr/local/bin/agent; then
  echo "ERROR: /usr/local/bin/agent is missing or not executable." >&2
  exit 1
fi

if ! command -v agent >/dev/null 2>&1; then
  echo "ERROR: agent is not on PATH after install." >&2
  exit 1
fi

echo "Cursor Agent CLI ready:"
command -v agent
command -v cursor-agent || true
ls -la /usr/local/bin/agent /usr/local/bin/cursor-agent
