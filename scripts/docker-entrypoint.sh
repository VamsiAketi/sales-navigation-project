#!/bin/sh
set -e

ensure_cursor_agent_cli() {
  install_home="${CURSOR_AGENT_INSTALL_HOME:-/opt/cursor-agent}"
  export PATH="${install_home}/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"

  if command -v agent >/dev/null 2>&1 || command -v cursor-agent >/dev/null 2>&1; then
    return 0
  fi

  if [ ! -x /usr/local/bin/install-cursor-agent-cli.sh ]; then
    echo "WARN: Cursor Agent CLI is missing and install script is unavailable." >&2
    return 0
  fi

  echo "Cursor Agent CLI not found on PATH; installing to ${install_home}..."
  CURSOR_AGENT_INSTALL_HOME="$install_home" /usr/local/bin/install-cursor-agent-cli.sh
  chown -R node:node "$install_home" 2>/dev/null || true
}

ensure_cursor_agent_cli

cursor_state_root="${PAPERCLIP_CURSOR_STATE_ROOT:-/var/lib/cursor-state}"
mkdir -p "$cursor_state_root"
chown node:node "$cursor_state_root" 2>/dev/null || true

# Capture runtime UID/GID from environment variables, defaulting to 1000
PUID=${USER_UID:-1000}
PGID=${USER_GID:-1000}

# Adjust the node user's UID/GID if they differ from the runtime request
# and fix volume ownership only when a remap is needed
changed=0

if [ "$(id -u node)" -ne "$PUID" ]; then
    echo "Updating node UID to $PUID"
    usermod -o -u "$PUID" node
    changed=1
fi

if [ "$(id -g node)" -ne "$PGID" ]; then
    echo "Updating node GID to $PGID"
    groupmod -o -g "$PGID" node
    usermod -g "$PGID" node
    changed=1
fi

if [ "$changed" = "1" ]; then
    chown -R node:node /paperclip
fi

exec gosu node "$@"
