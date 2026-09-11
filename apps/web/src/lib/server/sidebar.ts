import type { RequestEvent } from '@sveltejs/kit';

/**
 * Sidebar rail state for ONE request (PRD F-8), decided on the server before render — the same
 * shape as theme and language (L-12, K-2): user preference → `dab_sidebar` cookie → expanded.
 *
 * Why both: the profile column makes the choice follow the user across devices (D-4), while the
 * cookie answers on the very first request of a browser that is not logged in yet, and keeps the
 * shell right if writing the profile fails. The state is stamped on <html> as `data-sidebar`, so
 * the rail is already narrow in the first byte — no flash of a wide sidebar, no JavaScript.
 */
export const SIDEBAR_COOKIE = 'dab_sidebar';

export type SidebarState = 'expanded' | 'collapsed';

/** Structural shape only, so the decision is testable without a whole SvelteKit event. */
export function resolveRequestSidebar(event: {
  readonly locals: {
    readonly session: { readonly user: { readonly sidebarCollapsed: boolean } } | null;
  };
  readonly cookies: { get(name: string): string | undefined };
}): SidebarState {
  const user = event.locals.session?.user;
  if (user) return user.sidebarCollapsed ? 'collapsed' : 'expanded';
  return event.cookies.get(SIDEBAR_COOKIE) === 'collapsed' ? 'collapsed' : 'expanded';
}

/** Remember the choice for this browser (one year), exactly like the theme cookie (L-11). */
export function rememberSidebar(event: RequestEvent, state: SidebarState): void {
  event.cookies.set(SIDEBAR_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: event.url.protocol === 'https:' || process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });
}
