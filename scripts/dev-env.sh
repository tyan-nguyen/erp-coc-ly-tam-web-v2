#!/usr/bin/env bash

set -euo pipefail

TARGET="${1:-}"
PORT="${2:-3000}"

if [[ -z "$TARGET" ]]; then
  echo "Cach dung: bash scripts/dev-env.sh <test|prod> [port]"
  exit 1
fi

bash scripts/use-env.sh "$TARGET"

echo "Khoi dong Next.js voi moi truong $TARGET tai port $PORT"
exec npx next dev --port "$PORT"
