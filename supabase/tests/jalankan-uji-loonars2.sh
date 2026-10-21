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
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0044_loonars2_utang_toko_dan_pengajuan_mingguan.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0045_loonars2_akses_pelaksana.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0046_loonars2_akses_web.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0047_loonars2_borongan_bahan_unit_dibangun.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0048_loonars2_borongan_otomatis.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0049_loonars2_bukti_transfer_otomatis.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0050_loonars2_bukti_diteruskan_ke_pelaksana.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0051_loonars2_utang_otomatis_cegah_double.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0052_loonars2_bukti_bayar_utang_toko.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0053_loonars2_laporan_utang_pdf.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0055_loonars2_bukti_cicilan_tanggal_waktu.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/loonars2_uji.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/loonars2_uji_utang.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/loonars2_uji_pelaksana.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/loonars2_uji_borongan.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/loonars2_uji_otomatis.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/loonars2_uji_bukti.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/loonars2_uji_bukti_utang.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/loonars2_uji_laporan_utang.sql
