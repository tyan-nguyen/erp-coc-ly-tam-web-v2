#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_FILE="$ROOT_DIR/sql/reset_master_data_test_seed.sql"

if [[ ! -f "$SQL_FILE" ]]; then
  echo "Khong tim thay file SQL: $SQL_FILE" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Thieu lenh 'psql'. Hay cai PostgreSQL client truoc khi chay script nay." >&2
  exit 1
fi

DB_URL="${DATABASE_URL:-${SUPABASE_DB_URL:-}}"
CONFIRMED="false"

for arg in "$@"; do
  case "$arg" in
    --yes)
      CONFIRMED="true"
      ;;
    *)
      echo "Tham so khong hop le: $arg" >&2
      echo "Cach dung: bash scripts/reset-master-data-test.sh --yes" >&2
      exit 1
      ;;
  esac
done

if [[ "$CONFIRMED" != "true" ]]; then
  cat >&2 <<'EOF'
Script nay se reset cac danh muc master-data test de nhap lai tu dau.
No chi nen duoc chay khi du lieu hien tai chi la du lieu test.

De chay that, dung:
  DATABASE_URL='postgres://...' bash scripts/reset-master-data-test.sh --yes

Hoac:
  SUPABASE_DB_URL='postgres://...' bash scripts/reset-master-data-test.sh --yes
EOF
  exit 1
fi

if [[ -n "$DB_URL" ]]; then
  echo "Dang chay reset master-data bang DATABASE_URL/SUPABASE_DB_URL..."
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_FILE"
else
  if [[ -z "${PGHOST:-}" || -z "${PGUSER:-}" || -z "${PGDATABASE:-}" ]]; then
    cat >&2 <<'EOF'
Chua co thong tin ket noi DB.
Hay cung cap 1 trong 2 cach:
  1. DATABASE_URL='postgres://...'
  2. SUPABASE_DB_URL='postgres://...'

Neu muon dung bien PGHOST/PGUSER/PGDATABASE/PGPASSWORD thi can set day du truoc khi chay.
EOF
    exit 1
  fi

  echo "Dang chay reset master-data bang bien PG*..."
  psql -v ON_ERROR_STOP=1 -f "$SQL_FILE"
fi

echo "Da chay xong sql/reset_master_data_test_seed.sql"
