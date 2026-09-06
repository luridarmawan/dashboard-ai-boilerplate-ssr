import type { Actions, ServerLoad } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';

/** Inquiries from the public contact form (R-5, R-6). */
export const load: ServerLoad = async (event) => {
  const page = event.url.searchParams.get('page') ?? '1';
  const state = event.url.searchParams.get('state') ?? '';
  const res = await apiFor(event).v1.m.example.admin.inquiries.get({
    query: { page, limit: '20', ...(state ? { state } : {}) },
  });
  if (!res.data?.success)
    error(
      res.status,
      res.status === 403 ? 'Anda tidak punya izin melihat pesan masuk' : 'Pesan tidak bisa dimuat',
    );
  return { inquiries: res.data.data, meta: res.data.meta, state };
};

export const actions: Actions = {
  state: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form))
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    const state = str(form, 'state') as 'new' | 'read' | 'replied' | 'spam';
    const r = unwrap(
      await apiFor(event)
        .v1.m.example.admin.inquiries({ id: str(form, 'id') })
        .put({ state }),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, `/m/example/inquiries${event.url.search}`);
  },
};
