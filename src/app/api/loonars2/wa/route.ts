import { GalatAkses, rpc } from '@/lib/laporan-investor/server';
import { AKSI_WA_LOONARS2 } from '@/lib/loonars2';

/**
 * POST /api/loonars2/wa — pintu WhatsApp modul Loonars 2 (migrasi 0043).
 *
 * Dipanggil MK Connect: (1) saat owner/pelaksana mengirim perintah Loonars 2
 * ke nomor WA sistem, dan (2) saat MK Connect mengambil/menandai antrean
 * pesan keluar (aksi outbox_ambil/outbox_selesai).
 *
 * Pola sama dengan /api/laporan-investor/wa: header x-sync-secret diteruskan
 * apa adanya ke RPC loonars2_wa; DATABASE yang mencocokkannya dengan Vault
 * mk_sync_shared_secret. Server ini tidak menyimpan rahasia apa pun dan
 * tidak memakai service-role key. Whitelist nomor & peran juga dicek di
 * database (loonars2_wa_users), bukan di sini.
 *
 * Body: { nomor: '62812…' | null, aksi: string, data?: object }
 * Respons: hasil RPC apa adanya, mis. { status, balasan }.
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

  const aksi = typeof body.aksi === 'string' ? body.aksi : '';
  if (!(AKSI_WA_LOONARS2 as readonly string[]).includes(aksi)) {
    return Response.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
  }
  const nomor = typeof body.nomor === 'string' ? body.nomor.replace(/\D/g, '') : '';
  const sistem = aksi === 'outbox_ambil' || aksi === 'outbox_selesai';
  if (!sistem && !/^(62|0|8)\d{7,14}$/.test(nomor)) {
    return Response.json({ error: 'Nomor tidak valid' }, { status: 400 });
  }
  const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {};

  try {
    const hasil = await rpc<Record<string, unknown>>(
      { jenis: 'wa', rahasia, nomor: nomor || 'sistem' },
      'loonars2_wa',
      { p_nomor: sistem ? null : nomor, p_aksi: aksi, p_data: data },
    );
    return Response.json(hasil);
  } catch (e) {
    if (e instanceof GalatAkses) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('loonars2/wa', e);
    return Response.json({ error: 'Gagal memproses perintah Loonars 2' }, { status: 500 });
  }
}
