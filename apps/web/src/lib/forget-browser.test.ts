import { describe, expect, test } from 'bun:test';
import { forgetBrowserStorage } from './forget-browser.ts';

describe('forgetBrowserStorage (A-5)', () => {
  test('mengosongkan localStorage, sessionStorage, IndexedDB, dan Cache Storage', async () => {
    const calls: string[] = [];
    forgetBrowserStorage({
      localStorage: { clear: () => calls.push('local') },
      sessionStorage: { clear: () => calls.push('session') },
      indexedDB: {
        databases: async () => [{ name: 'a' }, { name: 'b' }, {}],
        deleteDatabase: (name) => calls.push(`idb:${name}`),
      },
      caches: {
        keys: async () => ['c1'],
        delete: async (name) => {
          calls.push(`cache:${name}`);
          return true;
        },
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['local', 'session', 'idb:a', 'idb:b', 'cache:c1']);
  });

  test('API yang melempar atau tidak ada dilewati — submit form tidak boleh gagal', () => {
    expect(() =>
      forgetBrowserStorage({
        localStorage: {
          clear: () => {
            throw new Error('blocked');
          },
        },
        indexedDB: { deleteDatabase: () => undefined }, // no databases() in older browsers
      }),
    ).not.toThrow();
    expect(() => forgetBrowserStorage({})).not.toThrow();
  });
});
