import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        serif: ['"Times New Roman"', 'Times', 'serif'],
      },
      colors: {
        // Palet sidebar gelap (mengikuti referensi tampilan ERP)
        nav: {
          bg: '#0f1729',
          bgAlt: '#131c31',
          border: '#1e293b',
          text: '#94a3b8',
          textDim: '#64748b',
          active: '#2563eb',
        },
        // Warna aksen lama MKH dipertahankan agar identitas visual tidak hilang
        brand: {
          amber: '#f0a500',
          green: '#00b894',
          violet: '#a78bfa',
          sky: '#38bdf8',
          pink: '#ec4899',
          slate: '#64748b',
        },
      },
      boxShadow: {
        card: '0 1px 3px rgba(15,23,42,.08), 0 1px 2px rgba(15,23,42,.04)',
        cardHover: '0 8px 24px rgba(15,23,42,.10)',
      },
      keyframes: {
        spin: { to: { transform: 'rotate(360deg)' } },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn .18s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
