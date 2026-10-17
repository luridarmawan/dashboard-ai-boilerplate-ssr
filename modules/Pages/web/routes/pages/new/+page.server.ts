import { formToObject, validateForm } from '@core/contracts';
import { createTranslator } from '@core/i18n';
import type { Actions } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import { PageBody } from '../../../../api/schemas.ts';
import { slugError } from '../_form.ts';

export const actions: Actions = {
  default: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const raw = formToObject(form, { nullable: ['summary', 'body'] });
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        raw,
      );
    const v = validateForm(PageBody, raw); // the API's own schema
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
    const r = unwrap<{ success: true; data: { id: string } }>(
      await apiFor(event).v1.m.pages.pages.post(v.value),
    );
    if (!r.ok) {
      const field = slugError(t, r.failure.details);
      return actionFailure(
        field ? { ...r.failure, message: t('common.check_fields'), details: field } : r.failure,
        raw,
      );
    }
    redirect(303, `/m/pages/pages/${r.data.data.id}?saved=1`);
  },
};
