/**
 * Client-side half of a deliberate logout (A-5): wipe what this origin keeps in the browser —
 * localStorage, sessionStorage, IndexedDB and Cache Storage — before the logout form is sent.
 *
 * The server answers that form with `Clear-Site-Data: "storage"`, which does the same without
 * JavaScript; this runs first so browsers that ignore the header are covered too. It never
 * blocks or cancels the submit: every step is best-effort, and a storage API that throws (private
 * mode, blocked site data) is simply skipped. Core stores nothing here today — the sweep exists
 * for modules and third-party widgets that might.
 */
export interface BrowserStorageLike {
  readonly localStorage?: { clear(): void };
  readonly sessionStorage?: { clear(): void };
  readonly indexedDB?: {
    databases?(): Promise<{ name?: string }[]>;
    deleteDatabase(name: string): unknown;
  };
  readonly caches?: { keys(): Promise<string[]>; delete(name: string): Promise<boolean> };
}

export function forgetBrowserStorage(
  win: BrowserStorageLike = globalThis as BrowserStorageLike,
): void {
  try {
    win.localStorage?.clear();
  } catch {}
  try {
    win.sessionStorage?.clear();
  } catch {}
  // Async APIs: fire and forget — the navigation that follows must not wait for them.
  try {
    const idb = win.indexedDB;
    idb?.databases?.().then(
      (dbs) => {
        for (const db of dbs) if (db.name) idb.deleteDatabase(db.name);
      },
      () => {},
    );
  } catch {}
  try {
    const caches = win.caches;
    caches?.keys().then(
      (keys) => {
        for (const key of keys) void caches.delete(key);
      },
      () => {},
    );
  } catch {}
}
