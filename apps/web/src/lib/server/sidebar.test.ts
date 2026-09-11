import { describe, expect, test } from 'bun:test';
import { resolveRequestSidebar, SIDEBAR_COOKIE } from './sidebar.ts';

const event = (opts: { collapsedUser?: boolean; cookie?: string }) => ({
  locals: {
    session:
      opts.collapsedUser === undefined ? null : { user: { sidebarCollapsed: opts.collapsedUser } },
  },
  cookies: { get: (name: string) => (name === SIDEBAR_COOKIE ? opts.cookie : undefined) },
});

describe('resolveRequestSidebar (F-8)', () => {
  test('tanpa preferensi apa pun sidebar terbentang', () => {
    expect(resolveRequestSidebar(event({}))).toBe('expanded');
  });

  test('pengunjung anonim memakai cookie browsernya', () => {
    expect(resolveRequestSidebar(event({ cookie: 'collapsed' }))).toBe('collapsed');
    expect(resolveRequestSidebar(event({ cookie: 'expanded' }))).toBe('expanded');
    // Nilai asing diabaikan, bukan dianggap ciut.
    expect(resolveRequestSidebar(event({ cookie: 'yes' }))).toBe('expanded');
  });

  test('pengguna yang masuk memakai profilnya — cookie browser lain tidak mengubahnya', () => {
    expect(resolveRequestSidebar(event({ collapsedUser: true, cookie: 'expanded' }))).toBe(
      'collapsed',
    );
    expect(resolveRequestSidebar(event({ collapsedUser: false, cookie: 'collapsed' }))).toBe(
      'expanded',
    );
  });

  test('browser baru milik pengguna yang sama tetap ciut tanpa cookie (D-4)', () => {
    expect(resolveRequestSidebar(event({ collapsedUser: true }))).toBe('collapsed');
  });
});
