import { ClientUpdateBody, formToObject, validateForm } from '@core/contracts';
import { createTranslator } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const res = await apiFor(event).v1.clients({ id: event.params.id }).get();
  if (!res.data?.success)
    error(res.status === 404 ? 404 : res.status, t('tenants.detail.not_found'));
  return {
    client: res.data.data,
    /**
     * Deleting a tenant is the most destructive act in the app, so it takes two steps: `?confirm=delete`
     * opens the confirmation (a plain link — no JavaScript needed, L-22), and the action below still
     * refuses a POST whose typed code does not match. The URL survives a failed action, so the
     * confirmation stays open with its message.
     */
    confirmDelete: event.url.searchParams.get('confirm') === 'delete',
  };
};

export const actions: Actions = {
  save: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: t('common.form_expired'),
      });
    }
    const raw = formToObject(form);
    const v = validateForm(ClientUpdateBody, {
      name: raw.name,
      statusId: raw.active !== undefined ? 1 : 0,
    });
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
    const r = unwrap(await apiFor(event).v1.clients({ id: event.params.id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, raw);
    return { saved: true };
  },
  delete: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: t('common.form_expired'),
      });
    }
    // The confirmation is enforced HERE, not only in the markup: the caller must type the tenant's
    // own code, which is read back from the API rather than from a hidden field a client could edit.
    const current = await apiFor(event).v1.clients({ id: event.params.id }).get();
    if (!current.data?.success)
      error(current.status === 404 ? 404 : current.status, t('tenants.detail.not_found'));
    if (str(form, 'code').trim() !== current.data.data.code)
      return actionFailure({
        status: 422,
        code: 'confirm_failed',
        message: t('tenants.detail.delete_confirm_mismatch'),
      });
    const r = unwrap(await apiFor(event).v1.clients({ id: event.params.id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/tenants');
  },
};
