import { ClientCreateBody, formToObject, validateForm } from '@core/contracts';
import { createTranslator } from '@core/i18n';
import { redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const input = formToObject(form);
    if (!checkCsrf(event, form)) {
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        input,
      );
    }
    const v = validateForm(ClientCreateBody, input);
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: t('common.check_fields'),
          details: v.errors,
        },
        input,
      );
    const r = unwrap<{ success: true; data: { id: string } }>(
      await apiFor(event).v1.clients.post(v.value),
    );
    if (!r.ok) return actionFailure(r.failure, input);
    redirect(303, `/tenants/${r.data.data.id}`);
  },
};
