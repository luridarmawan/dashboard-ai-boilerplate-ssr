import { createTranslator } from '@core/i18n';
import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';

export const _layoutVariant = 'wide';

/**
 * The URL is the whole state of this page: `?q=` and `?page=`. That is what lets the search be
 * two layers over one `load` — a plain GET form without JavaScript, the same URL fetched in the
 * background with it (see +page.svelte) — and what makes a filtered list shareable either way.
 */
export const load: ServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const q = event.url.searchParams.get('q') ?? '';
  const pageNo = event.url.searchParams.get('page') ?? '1';
  const res = await apiFor(event).v1.m.hello.notes.get({
    query: { ...(q ? { q } : {}), page: pageNo, limit: '20' },
  });
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403 ? t('hello.notes.forbidden') : t('hello.notes.load_failed'),
    );
  return {
    rows: res.data.data,
    meta: res.data.meta,
    q,
    saved: event.url.searchParams.get('saved'),
  };
};
