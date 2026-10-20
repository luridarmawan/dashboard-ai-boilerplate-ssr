import { describe, expect, test } from 'bun:test';
import { analyticsEventName, sanitizeAnalyticsParams, track } from '../src/analytics.ts';

describe('analytics events', () => {
  test('module events are `<ns>.<name>`, flattened for the provider', () => {
    expect(analyticsEventName('example.item_created')).toBe('example_item_created');
    expect(analyticsEventName('login')).toBe('login');
    expect(analyticsEventName('Example.Item')).toBeNull();
    expect(analyticsEventName('a.b.c')).toBeNull();
    expect(analyticsEventName('example.item-created')).toBeNull();
    expect(analyticsEventName(`example.${'x'.repeat(40)}`)).toBeNull();
  });

  test('params keep short scalars and drop anything that looks personal', () => {
    expect(
      sanitizeAnalyticsParams({
        source: 'form',
        count: 3,
        ok: true,
        email: 'a@b.c',
        user_id: 'u1',
        customer_name: 'Budi',
        nested: { a: 1 },
        long: 'x'.repeat(101),
        'Bad-Key': 'x',
        nan: Number.NaN,
      }),
    ).toEqual({ source: 'form', count: 3, ok: true });
    expect(sanitizeAnalyticsParams(null)).toEqual({});
  });

  test('track() is a no-op without a document (SSR, tests)', () => {
    expect(() => track('example.item_created', { source: 'form' })).not.toThrow();
  });
});
