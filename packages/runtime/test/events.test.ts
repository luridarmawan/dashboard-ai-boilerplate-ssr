import { describe, expect, test } from 'bun:test';
import { defineHooks } from '@core/module-kit';
import { createEventBus } from '../src/events.ts';

describe('event bus (G-17, G-7)', () => {
  test('handlers run in registration order and see the payload + context', async () => {
    const seen: string[] = [];
    const bus = createEventBus({ log: () => {} });
    bus.on('system.ping', (p) => void seen.push(`a:${p.at}`), 'A');
    bus.on('system.ping', async (p, ctx) => void seen.push(`b:${p.at}:${ctx.requestId}`), 'B');
    const r = await bus.emit('system.ping', { at: 'x' }, { requestId: 'rid' });
    expect(seen).toEqual(['a:x', 'b:x:rid']);
    expect(r).toEqual({ event: 'system.ping', delivered: 2, failed: [] });
  });

  test('a throwing hook is logged and reported — never re-thrown, later hooks still run', async () => {
    const logs: Record<string, unknown>[] = [];
    const bus = createEventBus({ log: (e) => logs.push(e) });
    const seen: string[] = [];
    bus.on(
      'system.ping',
      () => {
        throw new Error('boom');
      },
      'Broken',
    );
    bus.on('system.ping', () => void seen.push('after'), 'Fine');
    const r = await bus.emit('system.ping', { at: 'y' });
    expect(seen).toEqual(['after']);
    expect(r.delivered).toBe(1);
    expect(r.failed).toEqual([{ module: 'Broken', error: 'boom' }]);
    expect(logs[0]).toMatchObject({
      level: 'error',
      msg: 'hook failed',
      module: 'Broken',
      event: 'system.ping',
    });
  });

  test('register() subscribes everything a module declared with defineHooks', async () => {
    const bus = createEventBus({ log: () => {} });
    let got = '';
    bus.register(
      defineHooks('Dummy', {
        'system.ping': (p) => {
          got = p.at;
        },
      }),
    );
    await bus.emit('system.ping', { at: 'z' });
    expect(got).toBe('z');
    expect(bus.subscriptions()).toEqual([{ module: 'Dummy', event: 'system.ping' }]);
  });

  test('emit with no subscribers resolves cleanly; unsubscribe works', async () => {
    const bus = createEventBus({ log: () => {} });
    expect(await bus.emit('user.created', { userId: 'u', clientId: null })).toEqual({
      event: 'user.created',
      delivered: 0,
      failed: [],
    });
    let n = 0;
    const off = bus.on('system.ping', () => void n++);
    await bus.emit('system.ping', { at: '1' });
    off();
    await bus.emit('system.ping', { at: '2' });
    expect(n).toBe(1);
  });
});
