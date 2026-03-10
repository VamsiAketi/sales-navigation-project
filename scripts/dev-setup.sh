#!/usr/bin/env bash
set -euo pipefail

# Configure shared Git hooks directory for this clone.
# This makes the checked-in hooks (like hooks/post-checkout) active.
git update-index --skip-worktree pnpm-lock.yaml || true

