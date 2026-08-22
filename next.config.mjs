/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
