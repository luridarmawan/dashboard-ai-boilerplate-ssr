import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';

/** External MCP servers of the active tenant (I-5). */
export const _layoutVariant = 'wide';

export const load: ServerLoad = async (event) => {
  const res = await apiFor(event).v1.m.ai.mcps.get();
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403
        ? 'Anda tidak punya izin melihat server MCP'
        : 'Server MCP tidak bisa dimuat',
    );
  return { mcps: res.data.data, saved: event.url.searchParams.get('saved') };
};
