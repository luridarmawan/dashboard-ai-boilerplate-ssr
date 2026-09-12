import { formToObject, validateForm } from '@core/contracts';
import { createTranslator } from '@core/i18n';
import type { Actions } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import { ProviderBody } from '../../../../api/schemas.ts';
import { parseModelLines } from '../_form.ts';

export const actions: Actions = {
  default: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const raw = formToObject(form);
    const apiKey = str(form, 'apiKey');
    const input = {
      ...raw,
      ...(apiKey ? { apiKey } : {}),
      models: parseModelLines(str(form, 'models')),
      enabled: raw.enabled !== undefined,
      isDefault: raw.isDefault !== undefined,
    };
    if (!apiKey) delete (input as { apiKey?: unknown }).apiKey;
    const values = { ...raw, apiKey: '' };
    if (!checkCsrf(event, form))
      return actionFailure(
        {
          status: 403,
          code: 'csrf_failed',
          message: t('common.form_expired'),
        },
        values,
      );
    const v = validateForm(ProviderBody, input); // the API's own schema (L-17)
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: t('common.check_fields'),
          details: v.errors,
        },
        values,
      );
    const r = unwrap<{ success: true; data: { id: string } }>(
      await apiFor(event).v1.m.ai.providers.post(v.value),
    );
    if (!r.ok) return actionFailure(r.failure, values);
    redirect(303, `/m/ai/providers/${r.data.data.id}?saved=1`);
  },
};
