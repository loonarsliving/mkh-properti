import { GalatAkses, GalatBatas, bacaOpsi, rpc } from '@/lib/laporan-investor/server';

/**
 * POST /api/laporan-investor/wa — dipanggil MK Connect saat SUPER ADMIN
 * mengirim "lapkeu" ke nomor WhatsApp sistem.
 *
 * Mengembalikan TAUTAN unduh sementara (bukan berkas): pengirim WA MK Connect
 * (Whacenter) melampirkan dokumen dari URL publik. Tautan berisi token acak
 * 256-bit dari database, berlaku 10 menit, maks 3 kali ambil (migrasi 0042);
 * PDF dibuat saat tautan diambil dan tidak disimpan di mana pun.
 *
 * Memakai fitur yang sudah ada (keputusan owner 2026-10-10):
 *   - Header x-sync-secret = rahasia sync MK Connect yang sama dengan
 *     sync_inbound. Server ini TIDAK menyimpan salinannya: header diteruskan
 *     ke Supabase dan database yang mencocokkannya dengan Vault
 *     mk_sync_shared_secret (ir_boleh_akses, migrasi 0041).
 *   - Siapa yang boleh meminta = peran super_admin di MK Connect; dicek di
 *     MK Connect sebelum memanggil route ini.
 * Body: { nomor: '62812…', dari?: 'YYYY-MM', sampai?: 'YYYY-MM', unit?: string[] }
 * Respons: { url, nama_berkas, kedaluwarsa_pada }
 * Spesifikasi sisi MK Connect: docs/laporan-investor/03-SPESIFIKASI-MKHSISTEM.md.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const rahasia = req.headers.get('x-sync-secret') ?? '';
  if (!rahasia) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Body harus JSON' }, { status: 400 });
  }

  const nomor = typeof body.nomor === 'string' ? body.nomor.replace(/\D/g, '').replace(/^0/, '62') : '';
  if (!/^62\d{8,14}$/.test(nomor)) return Response.json({ error: 'Nomor tidak valid' }, { status: 400 });

  const opsi = bacaOpsi(body);
  try {
    const hasil = await rpc<{ token: string; kedaluwarsa_pada: string }>(
      { jenis: 'wa', rahasia, nomor },
      'ir_buat_tautan_wa',
      { p_nomor: nomor, p_parameter: opsi },
    );
    const rentang = [opsi.dari, opsi.sampai].filter(Boolean).join('_');
    const namaBerkas = `Laporan-Investor-MKH${rentang ? `_${rentang}` : ''}.pdf`;
    const url = `${new URL(req.url).origin}/api/laporan-investor/unduh/${hasil.token}/${namaBerkas}`;
    return Response.json({ url, nama_berkas: namaBerkas, kedaluwarsa_pada: hasil.kedaluwarsa_pada });
  } catch (e) {
    if (e instanceof GalatAkses) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (e instanceof GalatBatas) return Response.json({ error: e.message }, { status: 429 });
    console.error('laporan-investor/wa', e);
    return Response.json({ error: 'Gagal membuat tautan laporan' }, { status: 500 });
  }
}
