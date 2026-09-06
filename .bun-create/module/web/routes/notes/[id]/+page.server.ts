import { formToObject, validateForm } from '@core/contracts';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import { NoteUpdateBody } from '../../../../api/schemas.ts';

export const load: ServerLoad = async (event) => {
  const id = String(event.params.id ?? '');
  const res = await apiFor(event).v1.m.hello.notes({ id }).get();
  if (!res.data?.success) error(res.status === 404 ? 404 : res.status, 'Note tidak ditemukan');
  return { row: res.data.data, saved: event.url.searchParams.has('saved') };
};

export const actions: Actions = {
  save: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    const raw = formToObject(form, { nullable: ['body'] });
    const input = { ...raw, pinned: raw.pinned !== undefined };
    if (!checkCsrf(event, form))
      return actionFailure(
        {
          status: 403,
          code: 'csrf_failed',
          message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
        },
        raw,
      );
    const v = validateForm(NoteUpdateBody, input);
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: 'Periksa isian yang ditandai',
          details: v.errors,
        },
        raw,
      );
    const r = unwrap(await apiFor(event).v1.m.hello.notes({ id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, raw);
    return { saved: true };
  },
  delete: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form))
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
      });
    const r = unwrap(await apiFor(event).v1.m.hello.notes({ id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/m/hello/notes?saved=deleted');
  },
};
