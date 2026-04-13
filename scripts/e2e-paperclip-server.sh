#!/usr/bin/env bash
# Start Paperclip for Playwright e2e with an isolated data directory (empty DB).
# Avoids ~/.paperclip state so onboarding tests always see a fresh instance.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PAPERCLIP_E2E_PORT:-3100}"
E2E_HOME="${PAPERCLIP_E2E_HOME:-$(mktemp -d "${TMPDIR:-/tmp}/paperclip-e2e-XXXXXX")}"

mkdir -p "$E2E_HOME/instances/default"

# shellcheck disable=SC2086
cat >"$E2E_HOME/instances/default/config.json" <<EOF
{
  "\$meta": { "version": 1, "updatedAt": "2026-01-01T00:00:00.000Z", "source": "onboard" },
  "database": { "mode": "embedded-postgres" },
  "logging": { "mode": "file" },
  "server": { "deploymentMode": "local_trusted", "host": "127.0.0.1", "port": ${PORT} },
  "auth": { "baseUrlMode": "auto" },
  "storage": { "provider": "local_disk" },
  "secrets": { "provider": "local_encrypted", "strictMode": false }
}
EOF

cd "$REPO_ROOT"
exec pnpm paperclipai run -d "$E2E_HOME"
