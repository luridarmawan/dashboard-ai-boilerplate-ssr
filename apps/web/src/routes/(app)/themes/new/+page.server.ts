import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import { previewsFor, seedFromBase } from '../_editor.server.ts';
import { readEditorForm, toApiBody } from '../_editor.ts';
import type { Actions, PageServerLoad } from './$types';

/** New custom theme: seeded from a registered theme (`?base=`), assembled, validated by the API (L-24). */
export const _layoutVariant = 'wide';

export const load: PageServerLoad = async (event) => {
  const scope = event.url.searchParams.get('scope') === 'global' ? 'global' : 'tenant';
  const vocab = await apiFor(event).v1.themes.custom.mine.get({
    query: scope === 'global' ? { scope: 'global' } : {},
  });
  if (!vocab.data?.success)
    error(vocab.status, vocab.status === 403 ? 'Anda tidak punya izin mengelola tema' : 'Gagal');
  const base = event.url.searchParams.get('base') ?? 'base';
  const values = seedFromBase(
    base,
    vocab.data.data.themes.map((t) => ({
      code: t.code,
      tokens: t.tokens,
      icons: t.icons,
      layouts: t.layouts,
    })),
  );
  if (!values) error(404, `Tema dasar "${base}" tidak ditemukan`);
  return { scope, vocab: vocab.data.data, values, previews: previewsFor(values) };
};

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const scope =
      event.url.searchParams.get('scope') === 'global' ? ('global' as const) : ('tenant' as const);
    const values = readEditorForm(form);
    if (!checkCsrf(event, form))
      return actionFailure(
        {
          status: 403,
          code: 'csrf_failed',
          message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
        },
        { values },
      );
    const r = unwrap<{ success: true; data: { id: string } }>(
      await apiFor(event).v1.themes.custom.post({ ...toApiBody(values), scope }),
    );
    if (!r.ok) return actionFailure(r.failure, { values, previews: previewsFor(values) });
    redirect(303, `/themes?saved=created${scope === 'global' ? '&scope=global' : ''}`);
  },
};
