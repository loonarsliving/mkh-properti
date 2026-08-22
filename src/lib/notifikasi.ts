/**
 * Notifikasi Telegram untuk event HR/payroll/komisi hasil sinkronisasi
 * MK Connect (gaji/bonus/reimbursement/hr_lain) — satu-satunya alur yang
 * masih memakai Telegram; bahan/tukang sudah pindah ke WhatsApp lewat
 * trigger database.
 *
 * PENTING — perubahan dari versi HTML lama:
 * verifikasi.html menaruh bot token Telegram langsung di dalam kode klien,
 * sehingga token itu ikut ter-commit ke repositori dan terkirim ke setiap
 * browser yang membuka halaman. Token tersebut TIDAK disalin ke sini.
 *
 * Sekarang token dibaca dari environment variable. Perlu diketahui: variabel
 * berawalan NEXT_PUBLIC_ tetap ikut ke bundle browser, jadi ini hanya
 * menghentikan token ter-commit — belum menjadikannya rahasia. Solusi yang
 * benar adalah memindahkan pengiriman notifikasi ke Edge Function (seperti
 * `sync-inbound`) sehingga token hanya hidup di server.
 *
 * Selama env belum diisi, notifikasi dilewati diam-diam dan proses approval
 * tetap berjalan — persis seperti versi lama yang juga mengabaikan kegagalan
 * pengiriman Telegram.
 */

const TOKEN = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN ?? '';

const CHAT_MAP: Record<string, string> = {
  AFP: '-1003825705531',
  IH: '-1004294561742',
  LL: '-5180682189',
  GCI: '-1003889729458',
  // GCR belum punya grup sendiri — jatuh ke chat default di bawah.
};

const CHAT_DEFAULT = '-5180682189';

export function telegramAktif(): boolean {
  return TOKEN.length > 0;
}

export function kirimTelegram(pesan: string, proyek: string): void {
  if (!TOKEN) return;
  const chatId = CHAT_MAP[proyek] ?? CHAT_DEFAULT;
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage?chat_id=${chatId}&parse_mode=HTML&text=${encodeURIComponent(pesan)}`;
  // Kegagalan notifikasi tidak boleh menggagalkan approval.
  void fetch(url, { method: 'GET', mode: 'no-cors' }).catch(() => {});
}
