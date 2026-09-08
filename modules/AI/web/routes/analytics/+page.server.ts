import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';

/** AI usage analytics (H-15): totals, per day, per provider/model, per user. `?days=7|30|90`. */
export const _layoutVariant = 'wide';

export const load: ServerLoad = async (event) => {
  const days = ['7', '30', '90'].includes(event.url.searchParams.get('days') ?? '')
    ? (event.url.searchParams.get('days') as string)
    : '30';
  const res = await apiFor(event).v1.m.ai.analytics.get({ query: { days } });
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403
        ? 'Anda tidak punya izin melihat analitik AI'
        : 'Analitik tidak bisa dimuat',
    );
  return { stats: res.data.data, days };
};
