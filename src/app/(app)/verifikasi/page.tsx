'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useJudul } from '@/components/shell/JudulProvider';
import { useSesi } from '@/components/shell/SesiProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, OverlaySimpan, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { fmt, rupiah } from '@/lib/format';
import { sbInsert, sbQuery, sbRpc, sbUpdate } from '@/lib/supabase';
import { kirimTelegram } from '@/lib/notifikasi';
import type { CrmPaymentReceipt, DataPengajuan, Pengajuan } from '@/types';

type Filter = 'pending' | 'approved' | 'rejected' | 'all' | 'crm';

const TIPE_LABEL: Record<string, { ikon: string; label: string; nada: string }> = {
  bahan: { ikon: '🧱', label: 'Pembelian Bahan', nada: 'bg-amber-100 text-amber-700' },
  tukang: { ikon: '👷', label: 'Bayar Tukang', nada: 'bg-orange-100 text-orange-700' },
  gaji: { ikon: '💼', label: 'Gaji Staf (Sinkronisasi)', nada: 'bg-blue-100 text-blue-700' },
  komisi: { ikon: '🏆', label: 'Komisi Sales (Sinkronisasi)', nada: 'bg-violet-100 text-violet-700' },
  bonus: { ikon: '🎁', label: 'Bonus Karyawan (Sinkronisasi)', nada: 'bg-pink-100 text-pink-700' },
  reimbursement: { ikon: '🧾', label: 'Reimbursement (Sinkronisasi)', nada: 'bg-teal-100 text-teal-700' },
  hr_lain: { ikon: '📋', label: 'Beban HR Lain (Sinkronisasi)', nada: 'bg-slate-100 text-slate-600' },
};

/**
 * Akun tujuan untuk pengajuan hasil sinkronisasi MK Connect. Nilai bahan/tukang
 * tidak ada di sini karena keduanya baru dibukukan lewat event
 * `finance_expense_transfer_confirmed` dari sisi database, bukan dari layar ini.
 */
const SYNC_COA: Record<string, { akun: string; nama: string }> = {
  gaji: { akun: '6-1001', nama: 'Gaji Staf' },
  komisi: { akun: '6-1008', nama: 'Komisi Sales' },
  bonus: { akun: '6-1009', nama: 'Bonus Karyawan' },
  reimbursement: { akun: '6-1010', nama: 'Reimbursement Karyawan' },
  hr_lain: { akun: '6-1007', nama: 'Beban Lain-lain' },
};

export default function HalamanVerifikasi() {
  return (
    <GuardHalaman izinkan={['cfo', 'verifikator']}>
      <IsiVerifikasi />
    </GuardHalaman>
  );
}

function IsiVerifikasi() {
  const sesi = useSesi();
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [data, setData] = useState<Pengajuan[] | null>(null);
  const [crm, setCrm] = useState<CrmPaymentReceipt[]>([]);
  const [galat, setGalat] = useState<string | null>(null);

  /**
   * Verifikator cabang (`VERIFIKATOR_LL` dsb) hanya melihat pengajuan
   * bahan/tukang dari cabangnya. MANAGER dan CFO melihat semuanya —
   * pembatasan yang sama dengan versi lama.
   */
  const proyekFilter = useMemo(() => {
    const pid = sesi.proyekId ?? '';
    return pid.startsWith('VERIFIKATOR_') ? pid.replace('VERIFIKATOR_', '') : '';
  }, [sesi.proyekId]);

  useJudul({
    judul: 'Verifikasi Pengajuan',
    deskripsi: proyekFilter
      ? `Antrian persetujuan cabang ${proyekFilter}`
      : 'Antrian persetujuan seluruh cabang',
    tampilkanFilter: false,
  });

  const muat = useCallback(async () => {
    setGalat(null);
    try {
      const qPengajuan = proyekFilter
        ? `proyek=eq.${encodeURIComponent(proyekFilter)}&tipe=in.(bahan,tukang)&select=*&order=created_at.desc`
        : 'select=*&order=created_at.desc';
      const qCrm = proyekFilter
        ? `proyek=eq.${encodeURIComponent(proyekFilter)}&select=*&order=created_at.desc`
        : 'select=*&order=created_at.desc';

      const [rows, crmRows] = await Promise.all([
        sbQuery<Pengajuan>('pengajuan', qPengajuan),
        sbQuery<CrmPaymentReceipt>('crm_payment_receipts', qCrm).catch(() => [] as CrmPaymentReceipt[]),
      ]);
      setData(rows);
      setCrm(crmRows);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
      setData([]);
    }
  }, [proyekFilter]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const stat = useMemo(() => {
    const d = data ?? [];
    const hariIni = new Date().toISOString().slice(0, 10);
    return {
      pending: d.filter((x) => x.status === 'pending').length,
      disetujuiHariIni: d.filter(
        (x) => x.status === 'approved' && x.updated_at?.slice(0, 10) === hariIni,
      ).length,
      ditolakHariIni: d.filter(
        (x) => x.status === 'rejected' && x.updated_at?.slice(0, 10) === hariIni,
      ).length,
      crmPerluKonfirmasi: crm.filter((x) => x.status === 'recorded').length,
    };
  }, [data, crm]);

  const tersaring = useMemo(() => {
    const d = data ?? [];
    return filter === 'all' ? d : d.filter((x) => x.status === filter);
  }, [data, filter]);

  async function setujui(item: Pengajuan) {
    const langsungJurnal = item.tipe !== 'bahan' && item.tipe !== 'tukang';
    const konfirmasi = langsungJurnal
      ? 'Setujui pengajuan ini dan masukkan ke jurnal?'
      : 'Setujui pengajuan ini? Jurnal akan otomatis terisi setelah Super Admin transfer dan mengirim bukti transfer via WhatsApp.';
    if (!window.confirm(konfirmasi)) return;

    setSibuk('Memproses persetujuan…');
    try {
      const d: DataPengajuan = item.data ?? {};
      const nominal = Number(d.nominal) || 0;
      const coa = SYNC_COA[item.tipe];

      // bahan/tukang: tidak ada penulisan jurnal di sini — sengaja. Jurnalnya
      // diisi oleh event finance_expense_transfer_confirmed di sisi database.
      if (coa) {
        const tgl = d.tgl ?? new Date().toISOString().slice(0, 10);
        const seqNo = await sbRpc<number | string>('next_mkh_no', { p_prefix: 'KK' });
        const no = `KK-${String(seqNo).padStart(3, '0')}`;
        const ket =
          d.ket ??
          `Sinkronisasi MK Connect: ${d.employee_name ?? d.sales_name ?? '—'} — ${item.tipe}`;

        if (item.tipe === 'gaji') {
          let karyawanId: number | null = null;
          if (d.mkc_employee_id) {
            const kRows = await sbQuery<{ id: number }>(
              'karyawan',
              `mkc_employee_id=eq.${encodeURIComponent(String(d.mkc_employee_id))}&select=id&limit=1`,
            );
            if (kRows.length > 0) karyawanId = kRows[0].id;
          }
          if (karyawanId === null) {
            const dibuat = await sbInsert<{ id: number }>('karyawan', [
              {
                proyek: item.proyek,
                nama: d.employee_name ?? '—',
                jabatan: '',
                gaji_pokok: d.base_salary ?? 0,
                mkc_employee_id: d.mkc_employee_id ?? null,
              },
            ]);
            karyawanId = dibuat[0].id;
          }
          await sbInsert('slip_gaji', [
            {
              karyawan_id: karyawanId,
              proyek: item.proyek,
              periode: `${d.period_month ?? ''}/${d.period_year ?? ''}`,
              nama: d.employee_name ?? '—',
              gaji_pokok: d.base_salary ?? 0,
              total_diterima: nominal,
              tgl_bayar: tgl,
              jurnal_no: no,
            },
          ]);
        }

        await sbInsert('jurnal', [
          { tgl, no, ket, akun: coa.akun, nama: coa.nama, proyek: item.proyek, d: nominal, k: 0 },
          { tgl, no, ket, akun: '1-1001', nama: 'Kas Tunai', proyek: item.proyek, d: 0, k: nominal },
        ]);

        // Komisi memakai jalur WhatsApp lewat trigger pengajuan_komisi_decided_sync.
        if (item.tipe !== 'komisi') {
          const info = TIPE_LABEL[item.tipe];
          kirimTelegram(
            `${info.ikon} <b>${info.label.toUpperCase()}</b>\n\n👤 ${
              d.employee_name ?? d.sales_name ?? '—'
            }\n💰 Nominal: <b>${rupiah(nominal)}</b>\n📅 Tanggal: <b>${tgl}</b>\n✅ Diverifikasi oleh: <b>${sesi.email}</b>`,
            item.proyek,
          );
        }
      }

      await sbUpdate('pengajuan', item.id, {
        status: 'approved',
        verified_by: sesi.email,
        updated_at: new Date().toISOString(),
      });

      setData((arr) =>
        (arr ?? []).map((x) =>
          x.id === item.id ? { ...x, status: 'approved', verified_by: sesi.email } : x,
        ),
      );
      toast.sukses(
        langsungJurnal
          ? 'Pengajuan disetujui dan masuk ke jurnal!'
          : 'Pengajuan disetujui! Menunggu Super Admin transfer + kirim bukti via WhatsApp.',
      );
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function tolak(item: Pengajuan) {
    if (!window.confirm('Tolak pengajuan ini?')) return;
    setSibuk('Menolak pengajuan…');
    try {
      await sbUpdate('pengajuan', item.id, {
        status: 'rejected',
        verified_by: sesi.email,
        updated_at: new Date().toISOString(),
      });
      setData((arr) =>
        (arr ?? []).map((x) =>
          x.id === item.id ? { ...x, status: 'rejected', verified_by: sesi.email } : x,
        ),
      );
      toast.info('Pengajuan ditolak.');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function konfirmasiCrm(item: CrmPaymentReceipt) {
    if (
      !window.confirm(
        'Konfirmasi bahwa dana ini sudah diterima dan tercatat dengan benar? MK Connect akan diberitahu otomatis.',
      )
    )
      return;
    setSibuk('Mengirim konfirmasi…');
    try {
      await sbUpdate('crm_payment_receipts', item.id, {
        status: 'confirmed',
        confirmed_by: sesi.email,
        confirmed_at: new Date().toISOString(),
      });
      setCrm((arr) =>
        arr.map((x) =>
          x.id === item.id ? { ...x, status: 'confirmed', confirmed_by: sesi.email } : x,
        ),
      );
      toast.sukses('Konfirmasi terkirim, MK Connect akan diperbarui otomatis.');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  if (data === null) return <Memuat pesan="Memuat antrian verifikasi…" />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muat()} />;

  const TAB: { id: Filter; label: string; badge?: number }[] = [
    { id: 'pending', label: 'Menunggu', badge: stat.pending },
    { id: 'approved', label: 'Disetujui' },
    { id: 'rejected', label: 'Ditolak' },
    { id: 'all', label: 'Semua' },
    { id: 'crm', label: 'Kas Masuk CRM', badge: stat.crmPerluKonfirmasi },
  ];

  return (
    <div className="space-y-4">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { l: 'Menunggu Verifikasi', v: stat.pending, c: 'text-amber-600' },
          { l: 'Disetujui Hari Ini', v: stat.disetujuiHariIni, c: 'text-emerald-600' },
          { l: 'Ditolak Hari Ini', v: stat.ditolakHariIni, c: 'text-rose-600' },
          { l: 'CRM Perlu Konfirmasi', v: stat.crmPerluKonfirmasi, c: 'text-blue-600' },
        ].map((s) => (
          <div key={s.l} className="card-pad">
            <div className="label-mono">{s.l}</div>
            <div className={`text-[22px] font-bold ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>

      <div className="card-pad flex flex-wrap gap-1.5">
        {TAB.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`btn-xs ${
              filter === t.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t.label}
            {t.badge ? (
              <span
                className={`ml-1 rounded-full px-1.5 text-[9px] ${
                  filter === t.id ? 'bg-white/25' : 'bg-slate-300 text-slate-700'
                }`}
              >
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
        <button
          onClick={() => void muat()}
          className="btn-xs ml-auto bg-slate-100 text-slate-600 hover:bg-slate-200"
        >
          <Icon name="segar" className="h-3 w-3" /> Muat Ulang
        </button>
      </div>

      {filter === 'crm' ? (
        crm.length === 0 ? (
          <Kosong pesan="Belum ada pembayaran CRM yang tersinkronisasi." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {crm.map((item) => (
              <KartuCrm key={item.id} item={item} onKonfirmasi={() => void konfirmasiCrm(item)} />
            ))}
          </div>
        )
      ) : tersaring.length === 0 ? (
        <Kosong
          pesan={`Tidak ada pengajuan ${filter === 'pending' ? 'yang menunggu verifikasi' : filter}.`}
          ikon="ceklis"
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {tersaring.map((item) => (
            <KartuPengajuan
              key={item.id}
              item={item}
              onSetujui={() => void setujui(item)}
              onTolak={() => void tolak(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Detail({ label, nilai }: { label: string; nilai?: string | number | null }) {
  return (
    <div>
      <div className="label-mono">{label}</div>
      <div className="break-words text-[12px] text-slate-700">{nilai || '—'}</div>
    </div>
  );
}

function KartuPengajuan({
  item,
  onSetujui,
  onTolak,
}: {
  item: Pengajuan;
  onSetujui: () => void;
  onTolak: () => void;
}) {
  const d: DataPengajuan = item.data ?? {};
  const info = TIPE_LABEL[item.tipe] ?? TIPE_LABEL.bahan;
  const nominal = Number(d.nominal) || 0;
  const tgl = d.tgl ?? item.created_at?.slice(0, 10) ?? '-';
  const pending = item.status === 'pending';
  const sudahDibayar = Boolean(d.paid_at);
  const menungguTransfer =
    item.status === 'approved' && (item.tipe === 'bahan' || item.tipe === 'tukang') && !sudahDibayar;

  const statusLabel = pending
    ? '⏳ Pending'
    : item.status === 'approved'
      ? menungguTransfer
        ? '💸 Menunggu Transfer'
        : sudahDibayar
          ? '✅ Sudah Ditransfer'
          : '✅ Disetujui'
      : '❌ Ditolak';

  const statusNada = pending
    ? 'bg-amber-100 text-amber-700'
    : item.status === 'approved'
      ? menungguTransfer
        ? 'bg-amber-100 text-amber-700'
        : 'bg-emerald-100 text-emerald-700'
      : 'bg-rose-100 text-rose-700';

  const waktu = item.created_at
    ? new Date(item.created_at).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';

  return (
    <div className="card-pad">
      <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className={`chip ${info.nada}`}>
            {info.ikon} {info.label}
          </span>
          <div className="mt-1.5 text-[11px] text-slate-500">
            📍 {d.proyek_nama ?? item.proyek} · 📅 {tgl}
          </div>
        </div>
        <span className={`chip ${statusNada}`}>{statusLabel}</span>
      </div>

      <div className="mb-3 text-[20px] font-bold text-slate-800">Rp {fmt(nominal)}</div>

      <div className="mb-3 grid grid-cols-2 gap-2.5 rounded-lg bg-slate-50 p-3">
        {item.tipe === 'bahan' ? (
          <>
            <Detail label="Item" nilai={d.item} />
            <Detail label="Supplier" nilai={d.supplier} />
            <Detail label="No. Transaksi" nilai={d.no} />
            <Detail label="Bayar Via" nilai={d.rek === '1-1001' ? 'Kas Tunai' : (d.rekNama ?? 'Bank')} />
            {d.ket ? (
              <div className="col-span-2">
                <Detail label="Keterangan" nilai={d.ket} />
              </div>
            ) : null}
          </>
        ) : item.tipe === 'tukang' ? (
          <>
            <Detail label="Tukang" nilai={d.tukang_nama} />
            <Detail label="Minggu ke-" nilai={d.minggu} />
            <Detail label="Blok Selesai" nilai={d.blok_selesai} />
            <Detail label="Bayar Via" nilai={d.rek === '1-1001' ? 'Kas Tunai' : (d.rekNama ?? 'Bank')} />
          </>
        ) : item.tipe === 'gaji' ? (
          <>
            <Detail label="Karyawan" nilai={`${d.employee_name ?? '—'} (${d.employee_code ?? '—'})`} />
            <Detail label="Periode" nilai={`${d.period_month ?? '—'}/${d.period_year ?? '—'}`} />
            <Detail label="Gaji Pokok" nilai={rupiah(d.base_salary)} />
            <Detail label="Sumber" nilai="MK Connect (otomatis)" />
          </>
        ) : item.tipe === 'komisi' ? (
          <>
            <Detail label="Sales" nilai={d.sales_name} />
            <Detail label="Cabang" nilai={d.branch_name} />
            <Detail label="Sumber" nilai="MK Connect (otomatis)" />
          </>
        ) : (
          <>
            <Detail label="Karyawan" nilai={`${d.employee_name ?? '—'} (${d.employee_code ?? '—'})`} />
            <div className="col-span-2">
              <Detail label="Deskripsi" nilai={d.description} />
            </div>
            <Detail label="Sumber" nilai="MK Connect (otomatis)" />
          </>
        )}
      </div>

      <p className="text-[10.5px] text-slate-400">
        📤 Diajukan oleh <b className="text-slate-600">{item.created_by || 'Admin'}</b> · {waktu}
        {item.verified_by ? (
          <>
            {' · '}✅ Diverifikasi oleh <b className="text-slate-600">{item.verified_by}</b>
          </>
        ) : null}
      </p>

      {menungguTransfer ? (
        <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10.5px] text-amber-800">
          💸 Menunggu Super Admin transfer dan mengirim bukti transfer via WhatsApp — jurnal terisi
          otomatis setelah itu.
        </p>
      ) : null}

      {pending ? (
        <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
          <button className="btn-green flex-1 py-1.5 text-[12px]" onClick={onSetujui}>
            ✅ Setujui
          </button>
          <button className="btn-danger flex-1 py-1.5 text-[12px]" onClick={onTolak}>
            ❌ Tolak
          </button>
        </div>
      ) : null}
    </div>
  );
}

function KartuCrm({ item, onKonfirmasi }: { item: CrmPaymentReceipt; onKonfirmasi: () => void }) {
  const perluKonfirmasi = item.status === 'recorded';
  const waktu = item.created_at
    ? new Date(item.created_at).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';

  return (
    <div className="card-pad">
      <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="chip bg-emerald-100 text-emerald-700">💰 Kas Masuk CRM (Sinkronisasi)</span>
          <div className="mt-1.5 text-[11px] text-slate-500">
            📍 {item.project_name ?? item.proyek}
            {item.unit_label ? ` · Unit ${item.unit_label}` : ''} · 📅 {item.payment_date ?? '-'}
          </div>
        </div>
        <span className={`chip ${perluKonfirmasi ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {perluKonfirmasi ? '⏳ Perlu Konfirmasi' : '✅ Dikonfirmasi'}
        </span>
      </div>

      <div className="mb-3 text-[20px] font-bold text-slate-800">Rp {fmt(item.amount)}</div>

      <div className="mb-3 grid grid-cols-2 gap-2.5 rounded-lg bg-slate-50 p-3">
        <Detail label="Customer" nilai={item.customer_name} />
        <Detail label="Jenis Pembayaran" nilai={item.payment_type} />
        <Detail label="Sales" nilai={item.sales_name} />
        <Detail label="Cabang" nilai={item.branch_name} />
        <Detail label="No. Jurnal" nilai={item.jurnal_no} />
        <Detail label="No. Referensi" nilai={item.reference_number} />
      </div>

      <p className="text-[10.5px] text-slate-400">
        🔄 Otomatis dari MK Connect · {waktu}
        {item.confirmed_by ? (
          <>
            {' · '}✅ Dikonfirmasi oleh <b className="text-slate-600">{item.confirmed_by}</b>
          </>
        ) : null}
      </p>

      {perluKonfirmasi ? (
        <button className="btn-green mt-3 w-full py-1.5 text-[12px]" onClick={onKonfirmasi}>
          ✅ Konfirmasi Penerimaan
        </button>
      ) : null}
    </div>
  );
}
