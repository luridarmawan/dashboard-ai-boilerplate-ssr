import { createTranslator } from '@core/i18n';
import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';

/** External MCP servers of the active tenant (I-5). */
export const _layoutVariant = 'wide';

export const load: ServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const res = await apiFor(event).v1.m.ai.mcps.get();
  if (!res.data?.success)
    error(res.status, t(res.status === 403 ? 'ai.mcps.forbidden' : 'ai.mcps.load_failed'));
  return { mcps: res.data.data, saved: event.url.searchParams.get('saved') };
};
