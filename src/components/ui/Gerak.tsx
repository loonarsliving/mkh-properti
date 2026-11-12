'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Mesin animasi (pustaka `motion`) versi ringan: hanya fitur dasar. Komponen
 * memakai `m.div`, bukan `motion.div`. `reducedMotion="user"` menghormati
 * pengaturan "kurangi gerakan" di perangkat.
 */
export function PenyediaGerak({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

/** Posisi animasi 0..1 → nilai antara `dari` dan `ke` (ease-out kubik). */
export function nilaiAntara(dari: number, ke: number, t: number): number {
  if (t >= 1) return ke;
  if (t <= 0) return dari;
  return dari + (ke - dari) * (1 - Math.pow(1 - t, 3));
}

/**
 * Angka yang "berhitung" menuju nilainya. Bingkai TERAKHIR selalu
 * `format(nilai)` persis -- animasi hanya hiasan, tidak pernah mengubah angka
 * akhir yang dibaca pengguna.
 */
export function AngkaBergerak({
  nilai,
  format,
  durasi = 750,
}: {
  nilai: number;
  format: (n: number) => string;
  durasi?: number;
}) {
  const [tampil, setTampil] = useState(nilai);
  const sebelum = useRef(0);

  useIsoLayoutEffect(() => {
    const kurangiGerak =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dari = sebelum.current;
    sebelum.current = nilai;
    if (kurangiGerak || !Number.isFinite(nilai) || dari === nilai) {
      setTampil(nilai);
      return;
    }
    const mulai = performance.now();
    let raf = 0;
    const langkah = (kini: number) => {
      const t = Math.min(1, (kini - mulai) / durasi);
      setTampil(t >= 1 ? nilai : Math.round(nilaiAntara(dari, nilai, t)));
      if (t < 1) raf = requestAnimationFrame(langkah);
    };
    langkah(mulai);
    return () => cancelAnimationFrame(raf);
  }, [nilai, durasi]);

  return <>{format(tampil)}</>;
}
