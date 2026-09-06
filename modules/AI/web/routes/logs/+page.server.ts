import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';

export const _layoutVariant = 'wide';

export const load: ServerLoad = async (event) => {
  const page = event.url.searchParams.get('page') ?? '1';
  const res = await apiFor(event).v1.m.ai.logs.get({ query: { page, limit: '50' } });
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403 ? 'Anda tidak punya izin melihat log AI' : 'Log tidak bisa dimuat',
    );
  return { logs: res.data.data, meta: res.data.meta };
};
