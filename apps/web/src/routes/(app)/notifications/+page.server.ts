import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** My notifications (J-4): list, mark one / all read — plain forms, no JavaScript needed (L-22). */
export const load: PageServerLoad = async (event) => {
  const unread = event.url.searchParams.get('unread') === '1';
  const res = await apiFor(event).v1.notifications.get({
    query: unread ? { unread: '1', limit: '100' } : { limit: '100' },
  });
  if (!res.data?.success) error(res.status, 'Notifikasi tidak bisa dimuat');
  return { items: res.data.data.items, unread: res.data.data.unread, onlyUnread: unread };
};

const csrfFail = () =>
  actionFailure({
    status: 403,
    code: 'csrf_failed',
    message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
  });

export const actions: Actions = {
  read: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const id = str(form, 'id');
    const r = unwrap(await apiFor(event).v1.notifications({ id }).read.put());
    if (!r.ok) return actionFailure(r.failure);
    const link = str(form, 'link');
    redirect(303, link.startsWith('/') && !link.startsWith('//') ? link : '/notifications');
  },
  readAll: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap(await apiFor(event).v1.notifications['read-all'].post());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/notifications');
  },
};
