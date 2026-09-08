import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import { previewsFor, seedFromBase } from '../_editor.server.ts';
import { readEditorForm, toApiBody } from '../_editor.ts';
import { attachLogo } from '../_logo.server.ts';
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
  const custom = vocab.data.data.themes.map((t) => ({
    code: t.code,
    tokens: t.tokens,
    icons: t.icons,
    layouts: t.layouts,
  }));
  // Every starting point as a card: file themes and this scope's custom themes.
  const baseCards = [
    ...vocab.data.data.bases.map((b) => ({ id: b.id, name: b.name.id })),
    ...vocab.data.data.themes.map((t) => ({ id: t.code, name: t.name.id })),
  ].map((b) => {
    const seed = seedFromBase(b.id, custom);
    return { ...b, preview: seed ? previewsFor(seed).light : '' };
  });
  return { scope, vocab: vocab.data.data, values, previews: previewsFor(values), baseCards };
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
    const logoError = await attachLogo(event, form, values);
    if (logoError)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: logoError,
          details: { logo: logoError },
        },
        { values, previews: previewsFor(values) },
      );
    const r = unwrap<{ success: true; data: { id: string } }>(
      await apiFor(event).v1.themes.custom.post({ ...toApiBody(values), scope }),
    );
    if (!r.ok) return actionFailure(r.failure, { values, previews: previewsFor(values) });
    redirect(303, `/themes?saved=created${scope === 'global' ? '&scope=global' : ''}`);
  },
};
