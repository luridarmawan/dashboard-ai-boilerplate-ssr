import { createTranslator } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import { attachAssets } from '../_assets.server.ts';
import { previewsFor, seedFromBase } from '../_editor.server.ts';
import { readEditorForm, toApiBody } from '../_editor.ts';
import type { Actions, PageServerLoad } from './$types';

/** New custom theme: seeded from a registered theme (`?base=`), assembled, validated by the API (L-24). */
export const _layoutVariant = 'wide';

export const load: PageServerLoad = async (event) => {
  const locale = event.locals.locale.locale;
  const t = createTranslator(locale);
  const scope = event.url.searchParams.get('scope') === 'global' ? 'global' : 'tenant';
  const vocab = await apiFor(event).v1.themes.custom.mine.get({
    query: scope === 'global' ? { scope: 'global' } : {},
  });
  if (!vocab.data?.success)
    error(
      vocab.status,
      vocab.status === 403 ? t('themes.error_forbidden') : t('themes.new.error_failed'),
    );
  const base = event.url.searchParams.get('base') ?? 'base';
  const values = seedFromBase(
    base,
    vocab.data.data.themes.map((th) => ({
      code: th.code,
      tokens: th.tokens,
      icons: th.icons,
      layouts: th.layouts,
    })),
  );
  if (!values) error(404, t('themes.new.error_base_not_found', { base }));
  const custom = vocab.data.data.themes.map((th) => ({
    code: th.code,
    tokens: th.tokens,
    icons: th.icons,
    layouts: th.layouts,
  }));
  // Every starting point as a card: file themes and this scope's custom themes.
  const baseCards = [
    ...vocab.data.data.bases.map((b) => ({ id: b.id, name: b.name[locale] })),
    ...vocab.data.data.themes.map((th) => ({ id: th.code, name: th.name[locale] })),
  ].map((b) => {
    const seed = seedFromBase(b.id, custom);
    return { ...b, preview: seed ? previewsFor(seed).light : '' };
  });
  return { scope, vocab: vocab.data.data, values, previews: previewsFor(values), baseCards };
};

export const actions: Actions = {
  default: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const scope =
      event.url.searchParams.get('scope') === 'global' ? ('global' as const) : ('tenant' as const);
    const values = readEditorForm(form);
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        { values },
      );
    const assetErrors = await attachAssets(event, form, values);
    if (Object.keys(assetErrors).length)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: Object.values(assetErrors).join('; '),
          details: assetErrors,
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
