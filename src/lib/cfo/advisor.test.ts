import { describe, expect, it } from 'vitest';
import { bacaPermintaan, GalatPermintaan, jawabAdvisor } from './advisor';
import { faktaCfo, jawabDeterministik } from './chat';
import { HARI, dataProduksi } from './fixture-uji';
import { susunModelCfo } from './model';
import { evaluasiKeputusan } from './penantang';

const model = susunModelCfo(dataProduksi(), HARI);

describe('advisor — validasi permintaan', () => {
  it('menerima tiga mode yang sah', () => {
    expect(bacaPermintaan({ mode: 'fakta' })).toEqual({ mode: 'fakta' });
    expect(bacaPermintaan({ mode: 'tanya', pertanyaan: '  kas berapa?  ' })).toEqual({ mode: 'tanya', pertanyaan: 'kas berapa?' });
    const e = bacaPermintaan({ mode: 'evaluasi', rencana: { nominal: 50_000_000, lini: 'L1', ket: 'renovasi', cicilan: 3 } });
    expect(e).toMatchObject({ mode: 'evaluasi', rencana: { nominal: 50_000_000, lini: 'L1', ket: 'renovasi', cicilan: 3 } });
  });

  it('menolak permintaan yang tidak lengkap atau aneh', () => {
    for (const b of [null, {}, { mode: 'tulis' }, { mode: 'tanya' }, { mode: 'evaluasi', rencana: { nominal: -1, lini: 'L1', ket: 'x' } },
      { mode: 'evaluasi', rencana: { nominal: 1000, lini: 'L9', ket: 'x' } }, { mode: 'evaluasi', rencana: { nominal: 1000, lini: 'L1' } }]) {
      expect(() => bacaPermintaan(b)).toThrow(GalatPermintaan);
    }
  });
});

describe('advisor — jawaban memakai mesin AI CFO yang sama', () => {
  it('mode fakta = faktaCfo, tanpa field tambahan', () => {
    const j = jawabAdvisor(model, { mode: 'fakta' });
    expect(j.fakta.map((f) => f.id)).toEqual(faktaCfo(model).map((f) => f.id));
    expect(j.label).toBe('ACTUAL');
    expect(Object.keys(j.fakta[0]).sort()).toEqual(['id', 'label', 'nilai', 'sumber', 'teks']);
  });

  it('mode tanya = jawabDeterministik apa adanya', () => {
    const q = 'berapa kas sekarang?';
    const j = jawabAdvisor(model, { mode: 'tanya', pertanyaan: q });
    expect(j.jawaban).toBe(jawabDeterministik(q, model, faktaCfo(model)).jawaban);
  });

  it('mode evaluasi = putusan CEO challenger apa adanya', () => {
    const rencana = { nominal: 2_000_000_000, lini: 'Grup' as const, ket: 'ekspansi lokasi baru' };
    const j = jawabAdvisor(model, { mode: 'evaluasi', rencana });
    expect(j.putusan).toBe(evaluasiKeputusan(model, rencana).putusan);
    expect(j.label).toBe('PROJECTION');
  });
});
