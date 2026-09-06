import { describe, expect, test } from 'bun:test';
import { createLogger, MASK, redact } from '../src/index.ts';

describe('masking lives inside the logger (M-7)', () => {
  test('sensitive keys are masked recursively, whatever the call site passed', () => {
    const out = redact({
      email: 'a@b.co',
      password: 'hunter22',
      nested: {
        apiKey: 'sk-live-123456789012',
        token_hash: 'abc',
        list: [{ authorization: 'Bearer zzz' }],
      },
      headers: { cookie: 'dab_session=abc; dab_csrf=def', 'x-request-id': 'r1' },
    });
    expect(out.email).toBe('a@b.co');
    expect(out.password).toBe(MASK);
    expect(out.nested.apiKey).toBe(MASK);
    expect(out.nested.token_hash).toBe(MASK);
    expect(out.nested.list[0]?.authorization).toBe(MASK);
    expect(out.headers.cookie).toBe(MASK);
    expect(out.headers['x-request-id']).toBe('r1');
  });
  test('secret-looking strings inside free text are masked; ids stay', () => {
    const out = redact({
      note: 'sent Bearer eyJhbGciOiJIUzI1NiJ9.abc.def to api',
      link: 'https://x/reset?dab_session=abcdef',
      key: 'sk-ant-api03-verysecretvalue',
      requestId: '01900000-0000-7000-8000-000000000001',
    });
    expect(out.note).toBe('sent Bearer *** to api');
    expect(out.link).toBe('https://x/reset?dab_session=***');
    expect(out.key).toBe(MASK); // key name matches
    expect(out.requestId).toBe('01900000-0000-7000-8000-000000000001');
  });
  test('a logger line is JSON with level, msg, request id and masked fields', () => {
    const lines: string[] = [];
    const log = createLogger({ base: { service: 'api' }, write: (_l, line) => lines.push(line) });
    log.child({ requestId: 'rid-1' }).warn('login failed', { email: 'a@b.co', password: 'nope' });
    const parsed = JSON.parse(lines[0] ?? '{}');
    expect(parsed.level).toBe('warn');
    expect(parsed.msg).toBe('login failed');
    expect(parsed.requestId).toBe('rid-1');
    expect(parsed.service).toBe('api');
    expect(parsed.password).toBe(MASK);
    expect(typeof parsed.t).toBe('string');
  });
  test('errors and cycles do not break the logger', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    expect(redact(a).self).toBe('[circular]');
    const e = redact(new Error('token=abc Bearer secretsecretsecret'));
    expect(e.message).toContain('Bearer ***');
  });
});
