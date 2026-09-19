import { formToObject, validateForm } from '@core/contracts';
import { createTranslator } from '@core/i18n';
import type { Actions } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import { NoteBody } from '../../../../api/schemas.ts';

export const actions: Actions = {
  default: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const raw = formToObject(form, { nullable: ['body'] });
    const input = { ...raw, pinned: raw.pinned !== undefined };
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        raw,
      );
    const v = validateForm(NoteBody, input); // the API's own schema (L-17)
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
      await apiFor(event).v1.m.hello.notes.post(v.value),
    );
    if (!r.ok) return actionFailure(r.failure, raw);
    redirect(303, `/m/hello/notes/${r.data.data.id}?saved=1`);
  },
};
