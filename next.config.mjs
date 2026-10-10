/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Pembuat PDF Laporan Investor (route /api/laporan-investor/*) memakai
  // @react-pdf/renderer di Node runtime; paket ini dimuat apa adanya dari
  // node_modules alih-alih dibundel ulang oleh Next.
  serverExternalPackages: ['@react-pdf/renderer'],
  // pdfkit memuat font standar (Helvetica dsb.) lewat import subpath
  // '#standard-fonts/*' yang tidak terlacak otomatis oleh Vercel; tanpa ini
  // render PDF gagal di produksi (MODULE_NOT_FOUND Helvetica.cjs).
  outputFileTracingIncludes: {
    '/api/laporan-investor/**': ['./node_modules/pdfkit/js/standard-fonts/**', './node_modules/pdfkit/js/data/**'],
  },

  // Halaman lama berbasis file .html sudah digantikan route Next.js.
  // Redirect ini menjaga URL lama (yang sudah dibagikan / di-bookmark staf
  // lapangan dan dipakai di link WhatsApp) tetap hidup setelah migrasi.
  async redirects() {
    const legacy = [
      ['/index.html', '/'],
      ['/login.html', '/login'],
      ['/no-access.html', '/no-access'],
      ['/admin-proyek.html', '/admin-proyek'],
      ['/pengeluaran.html', '/pengeluaran'],
      ['/verifikasi.html', '/verifikasi'],
      ['/laporan-keuangan.html', '/laporan-keuangan'],
      ['/lapor-pengeluaran.html', '/lapor-pengeluaran'],
      ['/lapor-biaya-lain.html', '/lapor-biaya-lain'],
      ['/lapor-biaya-lain-makassar.html', '/lapor-biaya-lain-makassar'],
    ];
    return legacy.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }));
  },
};

export default nextConfig;
