import { describe, expect, test } from 'bun:test';
import { BACKOFF_S, backoffMs, listTasks, registerTask, unregisterTask } from '../src/queue.ts';

describe('queue helpers (P2)', () => {
  test('backoff follows the schedule and caps at the last step', () => {
    expect(backoffMs(1)).toBe(BACKOFF_S[0]! * 1000);
    expect(backoffMs(3)).toBe(BACKOFF_S[2]! * 1000);
    expect(backoffMs(99)).toBe(BACKOFF_S[BACKOFF_S.length - 1]! * 1000);
    expect(backoffMs(0)).toBe(BACKOFF_S[0]! * 1000);
  });
  test('task names are namespaced and unique', () => {
    expect(() => registerTask('NoDots', () => undefined)).toThrow(/tidak valid/);
    registerTask('unit.sample', () => undefined, { description: { id: 'x', en: 'x' } });
    expect(() => registerTask('unit.sample', () => undefined)).toThrow(/sudah terdaftar/);
    expect(listTasks().some((t) => t.name === 'unit.sample' && t.module === 'unit')).toBe(true);
    unregisterTask('unit.sample');
  });
});
