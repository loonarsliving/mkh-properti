import { rpc, GalatAkses } from '@/lib/laporan-investor/server';
import { kesiapanInvestasi } from '@/lib/keuangan/kesiapan-investasi';
import { teksBriefingHarian, teksBriefingMingguan, teksPeringatanKritis, teksTutupBuku } from '@/lib/cfo/briefing';
import { komentarVarians, laporanSebelum, ringkasBulan, siapTutupBuku } from '@/lib/cfo/kerja';
import { ambilModel, type KredensialCfo } from '@/lib/cfo/server';
import { holdingUntukArsip } from '@/lib/cfo/holding';

/**
 * POST /api/cfo/briefing — pekerjaan terjadwal AI CFO.
 *
 * Pemanggil:
 *  1. pg_cron MKH Property (cfo_briefing_bangunkan, migrasi 0057/0058):
 *     header x-sync-secret, body { jenis }:
 *       'harian' | 'mingguan' | 'peringatan' → susun & antrekan WA owner
 *       'tindakan'   → sinkronkan daftar tindakan CFO (tanpa WA)
 *       'tutup_buku' → bila bulan lalu siap ditutup: bekukan ringkasan bulan,
 *                      komentar varians, kirim laporan WA
 *  2. CFO dari web: Authorization: Bearer <token>, body { jenis, kirim? } →
 *     pratinjau / kirim manual; 'tindakan' & 'tutup_buku' juga boleh dijalankan
 *     CFO (mis. tombol "Perbarui tindakan" / "Tutup buku sekarang").
 *
 * Semua angka dari mesin deterministik; tidak ada aksi uang.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JENIS = ['harian', 'mingguan', 'peringatan', 'tindakan', 'tutup_buku'] as const;
type Jenis = (typeof JENIS)[number];

export async function POST(req: Request): Promise<Response> {
  const rahasia = req.headers.get('x-sync-secret') ?? '';
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!rahasia && !token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* body kosong boleh */
  }
  const jenis = body.jenis as Jenis;
  if (!JENIS.includes(jenis)) {
    return Response.json({ error: `jenis harus ${JENIS.join(' | ')}` }, { status: 400 });
  }

  const k: KredensialCfo = token ? { jenis: 'cfo', token } : { jenis: 'wa', rahasia, nomor: '' };
  const url = (process.env.NEXT_PUBLIC_APP_URL || 'https://finance.haluoleo.id').replace(/\/$/, '');

  try {
    const { data, model, kerja, dataKerja } = await ambilModel(k);

    if (jenis === 'tindakan') {
      const hasil = await rpc<Record<string, unknown>>(k, 'cfo_tindakan_sinkron', { p_daftar: kerja.tindakan });
      return Response.json({ ...hasil, jumlah: kerja.tindakan.length });
    }

    if (jenis === 'tutup_buku') {
      const periode = siapTutupBuku(model, dataKerja);
      if (!periode) return Response.json({ status: 'belum_waktunya' });
      // Tindakan disinkronkan dulu agar prioritas di laporan sesuai keadaan terbaru.
      await rpc(k, 'cfo_tindakan_sinkron', { p_daftar: kerja.tindakan });
      const ringkas = ringkasBulan(model, periode);
      const komentar = komentarVarians(ringkas, laporanSebelum(dataKerja, periode), kerja.tindakan);
      const hasil = await rpc<{ status: string }>(k, 'cfo_tutup_buku', { p_periode: `${periode}-01`, p_data: { ...ringkas, holding: holdingUntukArsip(model, data, periode, dataKerja.laporan_bulanan) }, p_komentar: komentar });
      if (hasil.status !== 'ok') return Response.json({ ...hasil, periode });
      const wa = await rpc<{ status: string; antre: number }>(k, 'cfo_briefing_antre', {
        p_jenis: 'tutup_buku',
        p_pesan: teksTutupBuku(ringkas, komentar, url),
        p_kunci: `tutup_buku:${periode}`,
      });
      return Response.json({ status: 'ok', periode, wa });
    }

    let teks: string;
    let kunci: string;
    if (jenis === 'peringatan') {
      const p = teksPeringatanKritis(model, url);
      if (!p) return Response.json({ status: 'tidak_ada_peringatan_kritis' });
      teks = p.teks;
      kunci = p.kunci;
    } else {
      // Sinkron tindakan sebelum briefing agar daftar di WA = daftar di dashboard.
      if (jenis === 'harian' && k.jenis === 'wa') {
        await rpc(k, 'cfo_tindakan_sinkron', { p_daftar: kerja.tindakan }).catch((e: unknown) => console.error('sinkron tindakan', e));
      }
      teks = jenis === 'harian' ? teksBriefingHarian(model, url, kerja) : teksBriefingMingguan(model, url, kerja, kesiapanInvestasi(model, data));
      kunci = `${jenis}:${model.hariIni}`;
    }

    if (k.jenis === 'cfo') {
      if (body.kirim !== true) return Response.json({ status: 'pratinjau', teks });
      kunci = `manual:${jenis}:${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 12)}`;
    }
    const hasil = await rpc<{ status: string; antre: number }>(k, 'cfo_briefing_antre', {
      p_jenis: k.jenis === 'cfo' ? 'manual' : jenis,
      p_pesan: teks,
      p_kunci: kunci,
    });
    return Response.json({ ...hasil, kunci, teks: k.jenis === 'cfo' ? teks : undefined });
  } catch (e) {
    if (e instanceof GalatAkses) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('cfo/briefing', e);
    return Response.json({ error: 'Gagal menjalankan pekerjaan CFO' }, { status: 500 });
  }
}
