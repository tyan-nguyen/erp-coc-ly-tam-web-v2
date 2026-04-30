#!/usr/bin/env bash

set -euo pipefail

TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "Cach dung: bash scripts/use-env.sh <test|prod>"
  exit 1
fi

SOURCE_FILE=".env.${TARGET}.local"

if [[ ! -f "$SOURCE_FILE" ]]; then
  echo "Khong tim thay $SOURCE_FILE"
  exit 1
fi

cp "$SOURCE_FILE" .env.local

echo "Da chuyen .env.local sang moi truong: $TARGET"
echo "Dang dung noi dung tu: $SOURCE_FILE"
