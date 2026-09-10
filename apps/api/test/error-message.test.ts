import { describe, expect, test } from 'bun:test';
import { describeCause, safeMessage } from '../src/plugins/request-context.ts';

/**
 * A failing INSERT must stay diagnosable without writing down what was being inserted: drizzle
 * puts the bound parameters in its own message, and for `ai_providers` those parameters include
 * the provider's API key.
 */
describe('safeMessage', () => {
  const drizzle =
    'Failed query: insert into `ai_providers` (`id`, `api_key`) values (?, ?)\n' +
    'params: 01a0891e-ce41-7443-a8c6-23eca974ebe0,sk-live-not-a-real-key';

  test('drops the bound parameters but keeps the SQL', () => {
    const out = safeMessage(new Error(drizzle));
    expect(out).not.toContain('sk-live-not-a-real-key');
    expect(out).toContain('insert into `ai_providers`');
    expect(out).toContain('[disamarkan]');
  });

  test('leaves an ordinary message alone', () => {
    expect(safeMessage(new Error('Access denied for user'))).toBe('Access denied for user');
    expect(safeMessage('ECONNREFUSED')).toBe('ECONNREFUSED');
  });

  test('scrubs the cause chain too', () => {
    const err = new Error('wrapped', { cause: new Error(drizzle) });
    const out = describeCause(err) ?? '';
    expect(out).not.toContain('sk-live-not-a-real-key');
    expect(out).toContain('[disamarkan]');
  });
});
