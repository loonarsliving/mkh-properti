#!/usr/bin/env bash
# Menjalankan uji modul Loonars 2 terhadap database Postgres lokal KOSONG
# (bukan Supabase produksi). Butuh server Postgres 16 yang bisa diakses lewat
# variabel PG* standar (PGHOST, PGPORT, PGUSER).
#   PGHOST=/tmp/pg PGPORT=54329 PGUSER=postgres supabase/tests/jalankan-uji-loonars2.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${UJI_DB:-uji_loonars2}
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/loonars2_stub.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0043_loonars2_keuangan.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/loonars2_uji.sql
