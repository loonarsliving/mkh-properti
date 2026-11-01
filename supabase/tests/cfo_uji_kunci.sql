-- Uji migrasi 0060: proyek dikunci hanya-baca, Loonars tetap jalan.
\set ON_ERROR_STOP 1
insert into public.jurnal (tgl, no, akun, proyek, d, k) values ('2026-10-30', 'LL-T1', '1-1001', 'LL', 1000, 0), ('2026-10-30', 'LC-T1', '1-1001', 'LC', 500, 0);
insert into public.pengajuan (proyek, tipe, status, data) values ('LL', 'bahan', 'pending', '{"nominal":1000}');

do $$
declare n int;
begin
  -- jurnal proyek dikunci ditolak
  begin
    insert into public.jurnal (tgl, no, akun, proyek, d, k) values ('2026-11-01', 'X', '1-1001', 'AFP', 1, 0);
    raise exception 'GAGAL: jurnal AFP seharusnya ditolak';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.jurnal (tgl, no, akun, proyek, d, k) values ('2026-11-01', 'X', '1-1001', ' kdi', 1, 0);
    raise exception 'GAGAL: jurnal kdi (huruf kecil/spasi) seharusnya ditolak';
  exception when insufficient_privilege then null;
  end;
  -- memindah jurnal LL ke proyek dikunci ditolak
  begin
    update public.jurnal set proyek = 'GCI' where no = 'LL-T1';
    raise exception 'GAGAL: pindah ke GCI seharusnya ditolak';
  exception when insufficient_privilege then null;
  end;
  -- LL & LC tetap bisa
  update public.jurnal set d = 2000 where no = 'LL-T1';
  insert into public.jurnal (tgl, no, akun, proyek, d, k) values ('2026-11-01', 'LC-T2', '5-1001', 'LC', 10, 0);
  delete from public.jurnal where no = 'LC-T2';
  -- pengajuan baru proyek dikunci ditolak
  begin
    insert into public.pengajuan (proyek, tipe, status, data) values ('GCR', 'bahan', 'pending', '{}');
    raise exception 'GAGAL: pengajuan GCR seharusnya ditolak';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Pengajuan lama proyek dikunci (dibuat sebelum kunci → disisipkan dengan trigger dimatikan sementara)
alter table public.pengajuan disable trigger trg_pengajuan_proyek_dikunci;
insert into public.pengajuan (id, proyek, tipe, status, data) values (9001, 'GCI', 'bahan', 'pending', '{"nominal":5}'), (9002, 'GCI', 'bahan', 'pending', '{"nominal":6}');
alter table public.pengajuan enable trigger trg_pengajuan_proyek_dikunci;

do $$
begin
  -- boleh ditolak
  update public.pengajuan set status = 'rejected', data = data || '{"alasan":"proyek dikunci"}' where id = 9001;
  -- tidak boleh disetujui
  begin
    update public.pengajuan set status = 'approved' where id = 9002;
    raise exception 'GAGAL: approve GCI seharusnya ditolak';
  exception when insufficient_privilege then null;
  end;
  -- tidak boleh dihapus
  begin
    delete from public.pengajuan where id = 9002;
    raise exception 'GAGAL: hapus pengajuan GCI seharusnya ditolak';
  exception when insufficient_privilege then null;
  end;
  -- pengajuan LL tetap bisa disetujui
  update public.pengajuan set status = 'approved' where proyek = 'LL';
  if (select count(*) from public.proyek_kunci) <> 5 then raise exception 'GAGAL: proyek_kunci harus 5 baris'; end if;
  if not exists (select 1 from public.cfo_audit_log where aksi = 'kunci_proyek') then raise exception 'GAGAL: audit kunci_proyek'; end if;
  if (select status from public.pengajuan where id = 9001) <> 'rejected' then raise exception 'GAGAL: tolak'; end if;
end $$;

-- RLS: anon tidak bisa membaca proyek_kunci
do $$
begin
  if has_table_privilege('anon', 'public.proyek_kunci', 'select') then raise exception 'GAGAL: anon bisa baca proyek_kunci'; end if;
  if has_table_privilege('authenticated', 'public.proyek_kunci', 'insert') then raise exception 'GAGAL: authenticated bisa tulis proyek_kunci'; end if;
end $$;
select 'uji 0060 kunci proyek: LULUS' as hasil;
