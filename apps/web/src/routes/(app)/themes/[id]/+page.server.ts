import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import { previewsFor } from '../_editor.server.ts';
import { readEditorForm, toApiBody, valuesOf } from '../_editor.ts';
import type { Actions, PageServerLoad } from './$types';

/** Edit / delete a custom theme (L-24). Saving re-validates the full contract on the API. */
export const _layoutVariant = 'wide';

export const load: PageServerLoad = async (event) => {
  const id = String(event.params.id ?? '');
  const api = apiFor(event);
  const one = await api.v1.themes.custom({ id }).get();
  if (!one.data?.success) error(one.status === 404 ? 404 : one.status, 'Tema tidak ditemukan');
  const t = one.data.data;
  const vocab = await api.v1.themes.custom.mine.get({
    query: t.scope === 'global' ? { scope: 'global' } : {},
  });
  if (!vocab.data?.success) error(vocab.status, 'Gagal memuat kosakata editor');
  const values = valuesOf(t);
  return {
    theme: t,
    vocab: vocab.data.data,
    values,
    previews: previewsFor(values),
    saved: event.url.searchParams.has('saved'),
  };
};

const csrfFail = (values: Record<string, unknown> = {}) =>
  actionFailure(
    { status: 403, code: 'csrf_failed', message: 'Sesi formulir kedaluwarsa — muat ulang halaman' },
    values,
  );

export const actions: Actions = {
  save: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    const values = readEditorForm(form);
    if (!checkCsrf(event, form)) return csrfFail({ values });
    const r = unwrap(await apiFor(event).v1.themes.custom({ id }).put(toApiBody(values)));
    if (!r.ok) return actionFailure(r.failure, { values, previews: previewsFor(values) });
    return { saved: true, values, previews: previewsFor(values) };
  },
  delete: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap(await apiFor(event).v1.themes.custom({ id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/themes?saved=deleted');
  },
};
