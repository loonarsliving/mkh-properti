#!/usr/bin/env bash
# Menjalankan uji migrasi 0057 (AI CFO) terhadap database Postgres lokal KOSONG
# (bukan Supabase produksi). Butuh server Postgres 16 lewat variabel PG* standar.
#   PGHOST=/tmp/pg PGPORT=54329 PGUSER=postgres supabase/tests/jalankan-uji-cfo.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${UJI_DB:-uji_cfo}
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/loonars2_stub.sql
for m in 0043 0044 0045 0046 0047 0048 0049 0050 0051 0052 0053 0055 0056; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/${m}_*.sql
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/cfo_stub.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0057_ai_cfo.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/cfo_uji.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0058_ai_cfo_meja_kerja.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/cfo_uji_kerja.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0059_ai_cfo_proyek_konstruksi.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/cfo_uji_proyek.sql
