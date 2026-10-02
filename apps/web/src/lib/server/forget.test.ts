import { describe, expect, test } from 'bun:test';
import { APP_COOKIES } from './cookies.ts';
import { CLEAR_SITE_DATA_HEADER, forgetBrowser } from './forget.ts';

const fakeEvent = () => {
  const deleted: { name: string; path: string }[] = [];
  const headers: Record<string, string> = {};
  return {
    deleted,
    headers,
    event: {
      cookies: {
        delete: (name: string, opts: { path: string }) => deleted.push({ name, path: opts.path }),
      },
      setHeaders: (h: Record<string, string>) => Object.assign(headers, h),
    },
  };
};

describe('forgetBrowser (A-5)', () => {
  test('menghapus setiap cookie yang ditulis aplikasi, dengan path-nya masing-masing', () => {
    const { event, deleted } = fakeEvent();
    forgetBrowser(event);
    expect(deleted).toEqual([...APP_COOKIES]);
    const names = deleted.map((d) => d.name);
    for (const must of [
      'crk_session',
      'crk_impersonate',
      'crk_csrf',
      'crk_oauth',
      'crk_theme',
      'crk_mode',
      'crk_lang',
      'crk_dir',
      'crk_sidebar',
    ])
      expect(names).toContain(must);
    // The OAuth cookie lives under its own path; deleting it at `/` would leave it behind.
    expect(deleted.find((d) => d.name === 'crk_oauth')?.path).toBe('/auth/google');
  });

  test('meminta browser membersihkan Web Storage lewat Clear-Site-Data, tanpa "cookies"', () => {
    const { event, headers } = fakeEvent();
    forgetBrowser(event);
    expect(headers[CLEAR_SITE_DATA_HEADER]).toBe('"storage"');
    expect(headers[CLEAR_SITE_DATA_HEADER]).not.toContain('cookies');
  });
});
