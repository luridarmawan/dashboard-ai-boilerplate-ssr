import { describe, expect, test } from 'bun:test';
import { defineHooks } from '../src/events.ts';
import { defineJobs, parseEvery, resolveJob } from '../src/jobs.ts';

describe('defineJobs / parseEvery (G-18, G-9)', () => {
  test('interval shapes', () => {
    expect(parseEvery(90)).toBe(90);
    expect(parseEvery('30s')).toBe(30);
    expect(parseEvery('5m')).toBe(300);
    expect(parseEvery('1h')).toBe(3600);
    expect(parseEvery('1d')).toBe(86400);
    expect(() => parseEvery('0s')).toThrow(/≥ 1 detik/);
    expect(() => parseEvery('soon')).toThrow(/tidak valid/);
    expect(() => parseEvery(1.5)).toThrow(/bilangan bulat/);
  });

  test('lease defaults to max(5 min, 2 × every)', () => {
    expect(resolveJob({ name: 'x.a', every: '1m', run: () => {} }).leaseSeconds).toBe(300);
    expect(resolveJob({ name: 'x.a', every: '1h', run: () => {} }).leaseSeconds).toBe(7200);
    expect(resolveJob({ name: 'x.a', every: '1h', lease: 60, run: () => {} }).leaseSeconds).toBe(
      60,
    );
  });

  test('names carry the module namespace and are unique', () => {
    expect(() => defineJobs('Billing', [{ name: 'cleanup', every: 60, run: () => {} }])).toThrow(
      /tidak valid/,
    );
    expect(() =>
      defineJobs('Billing', [{ name: 'other.cleanup', every: 60, run: () => {} }]),
    ).toThrow(/diawali "billing\."/);
    expect(() =>
      defineJobs('Billing', [
        { name: 'billing.a', every: 60, run: () => {} },
        { name: 'billing.a', every: 60, run: () => {} },
      ]),
    ).toThrow(/duplikat/);
    expect(
      defineJobs('Billing', [{ name: 'billing.a', every: '10m', run: () => {} }]),
    ).toHaveLength(1);
  });
});

describe('defineHooks (G-17)', () => {
  test('unknown events are rejected at definition time', () => {
    // @ts-expect-error — deliberately unknown event name
    expect(() => defineHooks('Billing', { 'invoice.paid': () => {} })).toThrow(/tidak dikenal/);
    expect(defineHooks('Billing', { 'user.created': () => {} }).ns).toBe('billing');
  });
});
