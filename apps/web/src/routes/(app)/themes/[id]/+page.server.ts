import { createTranslator, type Locale } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import { attachAssets } from '../_assets.server.ts';
import { previewsFor } from '../_editor.server.ts';
import { readEditorForm, toApiBody, valuesOf } from '../_editor.ts';
import type { Actions, PageServerLoad } from './$types';

/** Edit / delete a custom theme (L-24). Saving re-validates the full contract on the API. */
export const _layoutVariant = 'wide';

export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const id = String(event.params.id ?? '');
  const api = apiFor(event);
  const one = await api.v1.themes.custom({ id }).get();
  if (!one.data?.success)
    error(one.status === 404 ? 404 : one.status, t('themes.edit.error_not_found'));
  const theme = one.data.data;
  const vocab = await api.v1.themes.custom.mine.get({
    query: theme.scope === 'global' ? { scope: 'global' } : {},
  });
  if (!vocab.data?.success) error(vocab.status, t('themes.edit.error_vocab'));
  const values = valuesOf(theme);
  return {
    theme,
    vocab: vocab.data.data,
    values,
    previews: previewsFor(values),
    saved: event.url.searchParams.has('saved'),
  };
};

const csrfFail = (locale: Locale, values: Record<string, unknown> = {}) =>
  actionFailure(
    { status: 403, code: 'csrf_failed', message: createTranslator(locale)('common.form_expired') },
    values,
  );

export const actions: Actions = {
  save: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    const values = readEditorForm(form);
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale, { values });
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
    const r = unwrap(await apiFor(event).v1.themes.custom({ id }).put(toApiBody(values)));
    if (!r.ok) return actionFailure(r.failure, { values, previews: previewsFor(values) });
    return { saved: true, values, previews: previewsFor(values) };
  },
  delete: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap(await apiFor(event).v1.themes.custom({ id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/themes?saved=deleted');
  },
};
