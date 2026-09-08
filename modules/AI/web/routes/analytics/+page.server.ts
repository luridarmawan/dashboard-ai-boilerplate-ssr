import type { Actions, ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';

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
  const ledgerRes = await apiFor(event).v1.m.ai.credit.ledger.get();
  return {
    stats: {
      ...stats,
      byDay: stats.byDay.map((d) => ({ ...d, day: dayKey(d.day) })),
    },
    days,
    ledger: ledgerRes.data?.success ? ledgerRes.data.data : null,
  };
};

/** Balance top-up / adjustment (B-6): currency units, positive or negative; `unlimited` lifts the cap. */
export const actions: Actions = {
  credit: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    const unlimited = form.get('unlimited') !== null;
    const amount = Number(str(form, 'amount').replace(',', '.'));
    if (!unlimited && !Number.isFinite(amount))
      return actionFailure({
        status: 422,
        code: 'validation_failed',
        message: 'Jumlah tidak valid',
        details: { amount: 'angka, boleh negatif untuk koreksi' },
      });
    const note = str(form, 'note');
    const r = unwrap(
      await apiFor(event).v1.m.ai.credit.post({
        ...(unlimited ? { unlimited: true } : { amount }),
        ...(note ? { note } : {}),
      }),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { credited: true };
  },
};

const dayKey = (v: unknown): string =>
  typeof v === 'string' ? v.slice(0, 10) : new Date(v as string).toISOString().slice(0, 10);
