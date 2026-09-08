import { afterEach, describe, expect, test } from 'bun:test';
import type { Db } from '@core/db';
import { consume, parseRule } from '../src/rate-limit.ts';
import {
  configureRateLimitRedis,
  configureSessionRedis,
  type RedisCommands,
  resetRedisAdapters,
} from '../src/redis.ts';

/** In-memory Redis speaking the handful of commands the adapters send. */
function fakeRedis(opts: { failing?: boolean } = {}) {
  const store = new Map<string, { v: string | Set<string>; exp: number | null }>();
  const calls: string[] = [];
  const live = (k: string) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.exp !== null && e.exp <= Date.now()) {
      store.delete(k);
      return null;
    }
    return e;
  };
  const r: RedisCommands = {
    async send(command, args) {
      calls.push(command);
      if (opts.failing) throw new Error('ECONNREFUSED');
      switch (command) {
        case 'GET': {
          const e = live(args[0] as string);
          return e && typeof e.v === 'string' ? e.v : null;
        }
        case 'SET': {
          const ex = args[2] === 'EX' ? Date.now() + Number(args[3]) * 1000 : null;
          store.set(args[0] as string, { v: args[1] as string, exp: ex });
          return 'OK';
        }
        case 'DEL': {
          let n = 0;
          for (const k of args) if (store.delete(k)) n++;
          return n;
        }
        case 'INCR': {
          const e = live(args[0] as string);
          const n = (e && typeof e.v === 'string' ? Number(e.v) : 0) + 1;
          store.set(args[0] as string, { v: String(n), exp: e?.exp ?? null });
          return n;
        }
        case 'PEXPIREAT': {
          const e = live(args[0] as string);
          if (e) e.exp = Number(args[1]);
          return e ? 1 : 0;
        }
        case 'EXPIRE': {
          const e = live(args[0] as string);
          if (e) e.exp = Date.now() + Number(args[1]) * 1000;
          return e ? 1 : 0;
        }
        case 'SADD': {
          const e = live(args[0] as string);
          const set = e && e.v instanceof Set ? e.v : new Set<string>();
          for (const m of args.slice(1)) set.add(m);
          store.set(args[0] as string, { v: set, exp: e?.exp ?? null });
          return 1;
        }
        case 'SMEMBERS': {
          const e = live(args[0] as string);
          return e && e.v instanceof Set ? [...e.v] : [];
        }
        default:
          throw new Error(`fake redis: ${command} not implemented`);
      }
    },
  };
  return { r, store, calls };
}

/** A database stub that records whether it was touched — the Redis path must never reach it. */
function dbStub() {
  const hits = { n: 0 };
  const db = new Proxy({} as Db, {
    get() {
      hits.n++;
      throw new Error('database touched');
    },
  });
  return { db, hits };
}

describe('Redis adapters (Decision M, ROADMAP §8 item 7)', () => {
  afterEach(() => resetRedisAdapters());

  test('rate limit: fixed window in Redis — INCR + PEXPIREAT, same semantics as the table, no DB access', async () => {
    const { r, store, calls } = fakeRedis();
    configureRateLimitRedis(() => r);
    const { db, hits } = dbStub();
    const rule = parseRule('3/60');
    const t0 = new Date(Date.UTC(2026, 8, 8, 10, 0, 5));
    const a = await consume(db, 'login:ip:1.2.3.4', rule, t0);
    expect(a).toMatchObject({ allowed: true, limit: 3, remaining: 2 });
    expect(a.resetAt.toISOString()).toBe('2026-09-08T10:01:00.000Z');
    await consume(db, 'login:ip:1.2.3.4', rule, t0);
    const third = await consume(db, 'login:ip:1.2.3.4', rule, t0);
    expect(third).toMatchObject({ allowed: true, remaining: 0 });
    const fourth = await consume(db, 'login:ip:1.2.3.4', rule, t0);
    expect(fourth).toMatchObject({ allowed: false, remaining: 0 });
    // A new window starts fresh; the key carries the window start and an expiry at the window end.
    const next = await consume(db, 'login:ip:1.2.3.4', rule, new Date(t0.getTime() + 60_000));
    expect(next).toMatchObject({ allowed: true, remaining: 2 });
    const keys = [...store.keys()];
    expect(keys.some((k) => k.startsWith('dab:rl:login:ip:1.2.3.4:'))).toBe(true);
    expect(calls.filter((c) => c === 'PEXPIREAT').length).toBe(2); // once per window
    expect(hits.n).toBe(0);
  });

  test('rate limit: a failing Redis falls back to the database path (never fails open)', async () => {
    configureRateLimitRedis(() => fakeRedis({ failing: true }).r);
    const { db, hits } = dbStub();
    await expect(consume(db, 'k', parseRule('1/10'))).rejects.toThrow('database touched');
    expect(hits.n).toBeGreaterThan(0);
  });

  test('providers are lazy and resolve per call; a throwing provider counts as "no redis"', async () => {
    let on = false;
    const { r } = fakeRedis();
    configureRateLimitRedis(() => (on ? r : null));
    configureSessionRedis(() => {
      throw new Error('not configured');
    });
    const { db, hits } = dbStub();
    await expect(consume(db, 'k', parseRule('1/10'))).rejects.toThrow('database touched'); // off → DB
    on = true;
    expect((await consume(db, 'k', parseRule('1/10'))).allowed).toBe(true); // on → Redis
    expect(hits.n).toBe(1);
  });
});
