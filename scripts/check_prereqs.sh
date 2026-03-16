#!/usr/bin/env bash
set -euo pipefail

echo "Checking local prerequisites for xhsocr MVP..."

check_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "[OK] $cmd: $(command -v "$cmd")"
  else
    echo "[MISSING] $cmd"
  fi
}

check_cmd python3
check_cmd node
check_cmd npm
check_cmd pnpm
check_cmd psql
check_cmd redis-server
check_cmd git

echo
echo "Version summary:"
python3 --version 2>/dev/null || true
node --version 2>/dev/null || true
npm --version 2>/dev/null || true
pnpm --version 2>/dev/null || true
psql --version 2>/dev/null || true
redis-server --version 2>/dev/null || true

echo
echo "Done."
