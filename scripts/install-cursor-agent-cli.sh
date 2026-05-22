#!/bin/sh
# Install Cursor Agent CLI for Paperclip Docker/Kubernetes images.
#
# Primary: official installer (https://cursor.com/install) when available.
# Fallback: Cursor API + tarball (same path the CLI updater uses) when the
# installer endpoint is down — common in CI/container builds.
#
# Install root defaults to CURSOR_AGENT_INSTALL_HOME (/opt/cursor-agent in images)
# so /paperclip volume mounts do not hide the binary.
set -eu

install_home="${CURSOR_AGENT_INSTALL_HOME:-${PAPERCLIP_HOME:-${HOME:-/root}}}"
export HOME="$install_home"
mkdir -p "$HOME"

export PATH="${HOME}/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"

agent_ready() {
  command -v agent >/dev/null 2>&1 || command -v cursor-agent >/dev/null 2>&1
}

report_ready() {
  for cmd in agent cursor-agent; do
    if command -v "$cmd" >/dev/null 2>&1; then
      resolved="$(command -v "$cmd")"
      version="$("$cmd" --version 2>/dev/null || true)"
      echo "Cursor Agent CLI ready: ${resolved}${version:+ (${version})}}"
      return 0
    fi
  done
  return 1
}

detect_platform() {
  os="$(uname -s 2>/dev/null || echo unknown)"
  arch="$(uname -m 2>/dev/null || echo unknown)"
  case "$os" in
    Linux) platform_os="linux" ;;
    Darwin) platform_os="darwin" ;;
    *) echo "ERROR: Unsupported OS for Cursor Agent CLI install: ${os}" >&2; exit 1 ;;
  esac
  case "$arch" in
    x86_64|amd64) platform_arch="x64" ;;
    aarch64|arm64) platform_arch="arm64" ;;
    *) echo "ERROR: Unsupported CPU arch for Cursor Agent CLI install: ${arch}" >&2; exit 1 ;;
  esac
}

link_cli_shims() {
  version_dir="$1"
  bin_dir="${HOME}/.local/bin"
  mkdir -p "$bin_dir"
  agent_bin="${version_dir}/cursor-agent"
  if [ ! -x "$agent_bin" ]; then
    echo "ERROR: cursor-agent binary missing after install: ${agent_bin}" >&2
    return 1
  fi
  for name in agent cursor-agent; do
    target="${bin_dir}/${name}"
    rm -f "$target"
    ln -sf "$agent_bin" "$target"
  done
}

install_from_tarball() {
  version="$1"
  url_prefix="$2"
  detect_platform
  url_prefix="${url_prefix%/}"
  tarball_url="${url_prefix}/${platform_os}/${platform_arch}/agent-cli-package.tar.gz"

  versions_root="${HOME}/.local/share/cursor-agent/versions"
  version_dir="${versions_root}/${version}"
  staging_dir="${versions_root}/.${version}"

  mkdir -p "$versions_root"
  rm -rf "$staging_dir"
  mkdir -p "$staging_dir"

  echo "Downloading Cursor Agent CLI ${version} (${platform_os}/${platform_arch})..."
  if ! curl -fSL --retry 5 --retry-delay 3 --retry-all-errors "$tarball_url" \
    | tar --strip-components=1 -xzf - -C "$staging_dir"; then
    echo "ERROR: Failed to download or extract ${tarball_url}" >&2
    rm -rf "$staging_dir"
    return 1
  fi

  rm -rf "$version_dir"
  mv "$staging_dir" "$version_dir"
  link_cli_shims "$version_dir"
}

resolve_download_metadata() {
  if [ -n "${CURSOR_AGENT_VERSION:-}" ] && [ -n "${CURSOR_AGENT_URL_PREFIX:-}" ]; then
    printf '%s\n%s\n' "$CURSOR_AGENT_VERSION" "$CURSOR_AGENT_URL_PREFIX"
    return 0
  fi

  channel="${CURSOR_AGENT_CHANNEL:-prod}"
  python3 - <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request

channel = os.environ.get("CURSOR_AGENT_CHANNEL", "prod")
if channel == "prod-stable-internal":
    channel = "prod"

payload = json.dumps({"channel": channel}).encode("utf-8")
req = urllib.request.Request(
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCliDownloadUrl",
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
except urllib.error.HTTPError as err:
    body = err.read().decode("utf-8", errors="replace")
    print(f"ERROR: Cursor download API HTTP {err.code}: {body}", file=sys.stderr)
    sys.exit(1)
except Exception as err:
    print(f"ERROR: Cursor download API request failed: {err}", file=sys.stderr)
    sys.exit(1)

version = data.get("version")
url = data.get("url")
if not version or not url:
    print("ERROR: Cursor download API response missing version or url", file=sys.stderr)
    sys.exit(1)

print(version)
print(url)
PY
}

install_via_api_fallback() {
  metadata="$(resolve_download_metadata)" || return 1
  version="$(printf '%s\n' "$metadata" | sed -n '1p')"
  url_prefix="$(printf '%s\n' "$metadata" | sed -n '2p')"
  install_from_tarball "$version" "$url_prefix"
}

install_via_official_script() {
  echo "Installing Cursor Agent CLI via https://cursor.com/install (HOME=${HOME})..."
  if curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors https://cursor.com/install | bash; then
    return 0
  fi
  return 1
}

if agent_ready; then
  report_ready
  exit 0
fi

if install_via_official_script && agent_ready; then
  report_ready
  exit 0
fi

echo "Official Cursor installer unavailable; using API/tarball fallback..." >&2
if install_via_api_fallback && agent_ready; then
  report_ready
  exit 0
fi

echo "ERROR: Cursor Agent CLI install failed; agent is not on PATH (${HOME}/.local/bin)." >&2
exit 1
