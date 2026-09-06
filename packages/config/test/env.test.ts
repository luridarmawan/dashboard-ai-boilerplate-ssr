import { describe, expect, test } from 'bun:test';
import { EnvError, loadEnv } from '../src/index.ts';

const valid = {
  DATABASE_URL: 'mysql://app:app@127.0.0.1:33306/app',
};

describe('loadEnv (P-4, E-6, Keputusan M)', () => {
  test('nilai minimal valid → default terisi', () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.DB_DIALECT).toBe('mysql');
    expect(env.TABLE_PREFIX).toBe('');
    expect(env.SESSION_DRIVER).toBe('database');
    expect(env.LANDING_ROUTE).toBe('/example');
  });

  test('DATABASE_URL hilang → gagal cepat, menyebut kuncinya', () => {
    expect(() => loadEnv({})).toThrow(EnvError);
    try {
      loadEnv({});
    } catch (e) {
      expect((e as EnvError).problems.join('\n')).toContain('DATABASE_URL');
    }
  });

  test('semua masalah dilaporkan sekaligus, bukan satu-satu', () => {
    try {
      loadEnv({ DATABASE_URL: 'bukan-url', TABLE_PREFIX: 'Huruf-Besar', DB_DIALECT: 'oracle' });
      throw new Error('seharusnya melempar');
    } catch (e) {
      const p = (e as EnvError).problems.join('\n');
      expect(p).toContain('DATABASE_URL');
      expect(p).toContain('TABLE_PREFIX');
      expect(p).toContain('DB_DIALECT');
    }
  });

  test('string kosong diperlakukan sebagai tidak diset (REDIS_URL= dari compose)', () => {
    const env = loadEnv({ ...valid, REDIS_URL: '', INSTANCE_ID: '', TABLE_PREFIX: '' });
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.INSTANCE_ID).toBeUndefined();
    expect(env.TABLE_PREFIX).toBe('');
  });

  test('adapter memory ditolak di production (D1)', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production', CACHE_DRIVER: 'memory' })).toThrow(
      /memory.*production/,
    );
  });

  test('adapter memory boleh di development', () => {
    expect(loadEnv({ ...valid, CACHE_DRIVER: 'memory' }).CACHE_DRIVER).toBe('memory');
  });

  test('driver redis menuntut REDIS_URL', () => {
    expect(() => loadEnv({ ...valid, SESSION_DRIVER: 'redis' })).toThrow(/REDIS_URL/);
    expect(
      loadEnv({ ...valid, SESSION_DRIVER: 'redis', REDIS_URL: 'redis://127.0.0.1:6379' })
        .SESSION_DRIVER,
    ).toBe('redis');
  });

  test('skema URL harus cocok dengan dialect', () => {
    expect(() => loadEnv({ DB_DIALECT: 'postgres', DATABASE_URL: 'mysql://a:b@h/db' })).toThrow(
      /tidak cocok/,
    );
    expect(
      loadEnv({ DB_DIALECT: 'postgres', DATABASE_URL: 'postgresql://a:b@h/db' }).DB_DIALECT,
    ).toBe('postgres');
    expect(loadEnv({ DB_DIALECT: 'mariadb', DATABASE_URL: 'mysql://a:b@h/db' }).DB_DIALECT).toBe(
      'mariadb',
    );
  });
});
