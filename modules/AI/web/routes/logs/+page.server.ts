import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { tableStateFrom } from '$lib/components/table';
import { apiFor } from '$lib/server/session';

export const _layoutVariant = 'wide';

/** `YYYY-MM-DD` or nothing: a hand-edited URL must not turn into a 422 from the API. */
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/**
 * AI call log (H-9). The URL is the table state: `q` matches the user's name or e-mail, `model`
 * is one of the models the log has seen, `from`/`to` are inclusive days on the tenant's clock.
 */
export const load: ServerLoad = async (event) => {
  const st = tableStateFrom(event.url, {
    sort: 'created_at',
    order: 'desc',
    limit: 50,
    extra: ['model', 'from', 'to'],
  });
  const { model } = st.extra ?? {};
  const from = day(st.extra?.from);
  const to = day(st.extra?.to);
  const api = apiFor(event);
  const res = await api.v1.m.ai.logs.get({
    query: {
      page: String(st.page),
      limit: String(st.limit),
      ...(st.q ? { q: st.q } : {}),
      ...(model ? { model } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    },
  });
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403 ? 'Anda tidak punya izin melihat log AI' : 'Log tidak bisa dimuat',
    );
  const models = await api.v1.m.ai.logs.models.get();
  return {
    logs: res.data.data,
    models: models.data?.success ? models.data.data : [],
    state: {
      ...st,
      extra: {
        ...(model ? { model } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      },
      total: res.data.meta.total,
      totalPages: res.data.meta.totalPages,
    },
  };
};
