import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Job queue (P2): what is pending, running, done and dead-lettered in my scope. */
export const load: PageServerLoad = async (event) => {
  const status = event.url.searchParams.get('status');
  const ok = ['pending', 'running', 'done', 'dead'] as const;
  const res = await apiFor(event).v1.queue.get({
    query: {
      ...(ok.includes(status as (typeof ok)[number])
        ? { status: status as (typeof ok)[number] }
        : {}),
      limit: '100',
    },
  });
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403 ? 'Anda tidak punya izin melihat antrean' : 'Antrean tidak bisa dimuat',
    );
  return { ...res.data.data, status: status ?? '', saved: event.url.searchParams.get('saved') };
};

const csrfFail = () =>
  actionFailure({
    status: 403,
    code: 'csrf_failed',
    message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
  });

export const actions: Actions = {
  retry: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap(
      await apiFor(event)
        .v1.queue({ id: str(form, 'id') })
        .retry.post(),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(
      303,
      `/queue?saved=retried${str(form, 'status') ? `&status=${str(form, 'status')}` : ''}`,
    );
  },
  delete: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap(
      await apiFor(event)
        .v1.queue({ id: str(form, 'id') })
        .delete(),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(
      303,
      `/queue?saved=deleted${str(form, 'status') ? `&status=${str(form, 'status')}` : ''}`,
    );
  },
};
