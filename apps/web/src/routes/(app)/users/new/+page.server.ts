import { formToObject, UserCreateBody, validateForm } from '@core/contracts';
import { createTranslator } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const groups = await apiFor(event).v1.groups.get({ query: { limit: 100 } });
  if (!groups.data?.success) error(groups.status, t('groups.load_failed'));
  return { groups: groups.data.data };
};

export const actions: Actions = {
  default: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const input = formToObject(form, { arrays: ['groupIds'], nullable: ['phone'] });
    if (!checkCsrf(event, form)) {
      return actionFailure(
        {
          status: 403,
          code: 'csrf_failed',
          message: t('common.form_expired'),
        },
        input,
      );
    }
    // The SAME schema the API enforces (L-17): field errors render next to the field, no JS needed.
    const v = validateForm(UserCreateBody, input);
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
    const res = await apiFor(event).v1.users.post(v.value);
    const r = unwrap<{ success: true; data: { id: string } }>(res);
    if (!r.ok) return actionFailure(r.failure, input);
    redirect(303, `/users/${r.data.data.id}?created=1`);
  },
};
