import { describe, expect, test } from 'bun:test';
import { createUuidV7Generator, isUuidV7, newId, uuidV7Time } from '../src/id.ts';

/**
 * M0 gate #3: UUIDv7 is monotonic within the same millisecond. Cursor pagination (N-5)
 * and `ORDER BY id` rely on this property — far cheaper to prove now.
 */
describe('UUIDv7 (RFC 9562, O-6)', () => {
  test('bentuk: versi 7 dan varian 10xx', () => {
    for (let i = 0; i < 1000; i++) {
      const id = newId();
      expect(id).toHaveLength(36);
      expect(isUuidV7(id)).toBe(true);
      expect(id[14]).toBe('7');
      expect('89ab').toContain(id[19] ?? '');
    }
  });

  test('timestamp terkode = waktu pembuatan (±1 ms)', () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    const t = uuidV7Time(id);
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after + 1);
  });

  test('monotonik ketat dalam milidetik yang SAMA (jam dibekukan)', () => {
    const gen = createUuidV7Generator({ now: () => 1_700_000_000_000 });
    const ids = Array.from({ length: 2000 }, () => gen());
    for (let i = 1; i < ids.length; i++) {
      // Fixed-width lowercase hex → string order equals numeric order.
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('penghitung meluap (>4096 dalam 1 ms) → pinjam 1 ms ke depan, tetap monotonik', () => {
    const gen = createUuidV7Generator({
      now: () => 1_700_000_000_000,
      random: (n) => new Uint8Array(n), // counter seeded to 0 → overflows exactly after 4096
    });
    const ids = Array.from({ length: 5000 }, () => gen());
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
    expect(uuidV7Time(ids[0]!)).toBe(1_700_000_000_000);
    expect(uuidV7Time(ids[4999]!)).toBe(1_700_000_000_001);
  });

  test('jam mundur → timestamp terakhir dipertahankan, urutan tidak rusak', () => {
    let t = 1_700_000_000_500;
    const gen = createUuidV7Generator({ now: () => t });
    const a = gen();
    t -= 300; // NTP pulls the clock backwards
    const b = gen();
    const c = gen();
    expect(b > a).toBe(true);
    expect(c > b).toBe(true);
    expect(uuidV7Time(b)).toBe(1_700_000_000_500);
  });

  test('lintas milidetik: id dari ms berikutnya selalu lebih besar', () => {
    let t = 1_700_000_000_000;
    const gen = createUuidV7Generator({ now: () => t });
    const ids: string[] = [];
    for (let ms = 0; ms < 50; ms++) {
      for (let k = 0; k < 20; k++) ids.push(gen());
      t += 1;
    }
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
  });

  test('generator baku juga monotonik dalam loop ketat nyata', () => {
    const ids = Array.from({ length: 20_000 }, () => newId());
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
  });

  test('uuidV7Time menolak yang bukan v7', () => {
    expect(() => uuidV7Time('123e4567-e89b-42d3-a456-426614174000')).toThrow(TypeError);
  });
});
