import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';

export const _layoutVariant = 'wide';

export const load: ServerLoad = async (event) => {
  const q = event.url.searchParams.get('q') ?? '';
  const pageNo = event.url.searchParams.get('page') ?? '1';
  const res = await apiFor(event).v1.m.hello.notes.get({
    query: { ...(q ? { q } : {}), page: pageNo, limit: '20' },
  });
  if (!res.data?.success)
    error(res.status, res.status === 403 ? 'Anda tidak punya izin' : 'Data tidak bisa dimuat');
  return {
    rows: res.data.data,
    meta: res.data.meta,
    q,
    saved: event.url.searchParams.get('saved'),
  };
};
