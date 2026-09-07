import { describe, expect, test } from 'bun:test';
import {
  defineTools,
  type ToolDef,
  toolNameFromWire,
  toolWireName,
  validateTool,
} from '../src/tools.ts';

const base = {
  description: { id: 'Cari', en: 'Search' },
  input: { type: 'object' as const, properties: { q: { type: 'string' } } },
  run: () => 'ok',
};

describe('defineTools (extension point 8, I-3, G-9)', () => {
  test('names carry the module namespace, are unique and fit the wire limit', () => {
    expect(() => defineTools('Billing', [{ ...base, name: 'search' }])).toThrow(/tidak valid/);
    expect(() => defineTools('Billing', [{ ...base, name: 'other.search' }])).toThrow(
      /diawali "billing\."/,
    );
    expect(() =>
      defineTools('Billing', [
        { ...base, name: 'billing.search' },
        { ...base, name: 'billing.search' },
      ]),
    ).toThrow(/duplikat/);
    expect(() => defineTools('Billing', [{ ...base, name: `billing.${'x'.repeat(60)}` }])).toThrow(
      /64 karakter/,
    );
    expect(defineTools('Billing', [{ ...base, name: 'billing.search' }])).toHaveLength(1);
  });

  test('permission must belong to the module or to core; input must be an object schema', () => {
    expect(() =>
      defineTools('Billing', [{ ...base, name: 'billing.a', permission: 'example.product.read' }]),
    ).toThrow(/bukan milik modul ini maupun core/);
    expect(
      defineTools('Billing', [{ ...base, name: 'billing.a', permission: 'user.read' }]),
    ).toHaveLength(1);
    expect(() =>
      defineTools('Billing', [{ ...base, name: 'billing.a', permission: 'Bad Perm' }]),
    ).toThrow(/tidak valid/);
    expect(() =>
      // @ts-expect-error — deliberately not an object schema
      defineTools('Billing', [{ ...base, name: 'billing.a', input: { type: 'string' } }]),
    ).toThrow(/bertipe object/);
    expect(() =>
      defineTools('Billing', [{ ...base, name: 'billing.a', description: { id: '', en: 'x' } }]),
    ).toThrow(/description/);
    expect(() =>
      validateTool('billing', {
        ...base,
        name: 'billing.a',
        run: 'nope' as unknown as ToolDef['run'],
      }),
    ).toThrow(/run bukan fungsi/);
  });

  test('wire names round-trip (OpenAI/MCP forbid dots; the namespace never contains "_")', () => {
    expect(toolWireName('example.list_products')).toBe('example_list_products');
    expect(toolNameFromWire('example_list_products')).toBe('example.list_products');
    expect(toolNameFromWire('example_list-items')).toBe('example.list-items');
    expect(toolNameFromWire('nodots')).toBeNull();
    expect(toolNameFromWire('_leading')).toBeNull();
    expect(toolNameFromWire('trailing_')).toBeNull();
    expect(toolNameFromWire('Bad_Case')).toBeNull();
  });
});
