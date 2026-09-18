import { formToObject, validateForm } from '@core/contracts';
import { createTranslator } from '@core/i18n';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import {
  actionFailure,
  apiFor,
  checkCsrf,
  confirmed,
  confirmFail,
  unwrap,
} from '$lib/server/session';
import { ProductUpdateBody } from '../../../../api/schemas.ts';

export const load: ServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const id = String(event.params.id ?? '');
  const res = await apiFor(event).v1.m.example.admin.products({ id }).get();
  if (!res.data?.success)
    error(res.status === 404 ? 404 : res.status, t('example.admin.not_found'));
  return {
    product: res.data.data,
    saved: event.url.searchParams.has('saved'),
    /** Opens the delete confirmation; the action checks the same flag (see `confirmed`). */
    confirmDelete: confirmed(event),
  };
};

export const actions: Actions = {
  save: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    const raw = formToObject(form, { nullable: ['summary', 'description', 'imageUrl'] });
    const input = { ...raw, featured: raw.featured !== undefined };
    if (!checkCsrf(event, form))
      return actionFailure(
        {
          status: 403,
          code: 'csrf_failed',
          message: t('common.form_expired'),
        },
        raw,
      );
    const v = validateForm(ProductUpdateBody, input);
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: t('common.check_fields'),
          details: v.errors,
        },
        raw,
      );
    const r = unwrap(await apiFor(event).v1.m.example.admin.products({ id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, raw);
    return { saved: true };
  },
  delete: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form))
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: t('common.form_expired'),
      });
    // The confirmation is enforced HERE, not only in the markup: a POST that did not come from
    // the confirmation (modal or inline) is refused.
    if (!confirmed(event)) return confirmFail(event.locals.locale.locale);
    const r = unwrap(await apiFor(event).v1.m.example.admin.products({ id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/m/example/products?saved=deleted');
  },
};
