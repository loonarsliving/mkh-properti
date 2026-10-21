import { GalatAkses, rpc } from '@/lib/laporan-investor/server';

/**
 * POST /api/laporan-villa/ringkasan-wa — dipanggil MK Connect saat SUPER ADMIN
 * meminta laporan keuangan villa lewat asisten WhatsApp owner
 * (lib/ai/domains/owner-assistant.ts di Mkhsistem).
 *
 * Hanya-baca. Mengembalikan snapshot laporan_villa_bulanan (kiriman harian
 * villa-api) beserta pajak hotel terutang, lewat RPC villa_laporan_ringkasan_wa
 * (migrasi 0054). Akses sama dengan /api/laporan-investor/ringkasan-wa:
 * header x-sync-secret diteruskan apa adanya, database yang mencocokkannya
 * (ir_boleh_akses); MK Connect yang memastikan peminta adalah super_admin.
 *
 * Body: { nomor: '62812…', periode?: 'YYYY-MM' }  (bawaan: bulan berjalan)
 * Respons: { ada_data, periode, status, omzet_kotor, komisi_ota,
 *   pendapatan_bersih, cogs, gross_profit, opex, net_profit, pajak_hotel{…} }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const rahasia = req.headers.get('x-sync-secret') ?? '';
  if (!rahasia) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Body harus JSON' }, { status: 400 });
  }

  const nomor = typeof body.nomor === 'string' ? body.nomor.replace(/\D/g, '').replace(/^0/, '62') : '';
  if (!/^62\d{8,14}$/.test(nomor)) return Response.json({ error: 'Nomor tidak valid' }, { status: 400 });

  let periode: string | null = null;
  if (body.periode != null) {
    if (typeof body.periode !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.periode)) {
      return Response.json({ error: 'periode harus YYYY-MM' }, { status: 400 });
    }
    periode = `${body.periode}-01`;
  }

  try {
    const hasil = await rpc<Record<string, unknown>>({ jenis: 'wa', rahasia, nomor }, 'villa_laporan_ringkasan_wa', {
      p_peminta_wa: nomor,
      p_periode: periode,
    });
    return Response.json(hasil);
  } catch (e) {
    if (e instanceof GalatAkses) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('laporan-villa/ringkasan-wa', e);
    return Response.json({ error: 'Gagal menyusun ringkasan' }, { status: 500 });
  }
}
