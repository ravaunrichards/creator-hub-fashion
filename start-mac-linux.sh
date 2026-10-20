#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.5 or newer is required. Install it before starting Creator Hub Fashion." >&2
  exit 1
fi
if [[ ! -f .env ]]; then cp .env.example .env; fi
printf 'Creator Hub Fashion | Node.js %s\n' "$(node -p 'process.versions.node')"
printf 'Keep this terminal open while the storefront runs.\n'
printf 'Open http://localhost:3000 on this computer.\n'
printf 'For phone testing on the same Wi-Fi, use this computer local IP with port 3000.\n\n'
npm start
