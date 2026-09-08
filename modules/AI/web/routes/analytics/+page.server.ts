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
  // Eden Treaty turns ISO-looking strings into Date objects on the client side; `day` must stay
  // the "YYYY-MM-DD" key the template slices and keys on.
  const stats = res.data.data;
  return {
    stats: {
      ...stats,
      byDay: stats.byDay.map((d) => ({ ...d, day: dayKey(d.day) })),
    },
    days,
  };
};

const dayKey = (v: unknown): string =>
  typeof v === 'string' ? v.slice(0, 10) : new Date(v as string).toISOString().slice(0, 10);
