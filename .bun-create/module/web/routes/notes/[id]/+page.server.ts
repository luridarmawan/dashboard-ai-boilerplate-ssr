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
import { NoteUpdateBody } from '../../../../api/schemas.ts';

export const load: ServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const id = String(event.params.id ?? '');
  const res = await apiFor(event).v1.m.hello.notes({ id }).get();
  if (!res.data?.success) error(res.status === 404 ? 404 : res.status, t('hello.notes.not_found'));
  /** `confirmDelete` opens the delete confirmation; the action below checks the same flag. */
  return {
    row: res.data.data,
    saved: event.url.searchParams.has('saved'),
    confirmDelete: confirmed(event),
  };
};

export const actions: Actions = {
  save: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    const raw = formToObject(form, { nullable: ['body'] });
    const input = { ...raw, pinned: raw.pinned !== undefined };
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        raw,
      );
    const v = validateForm(NoteUpdateBody, input);
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
    const r = unwrap(await apiFor(event).v1.m.hello.notes({ id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, raw);
    return { saved: true };
  },
  delete: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form))
      return actionFailure({ status: 403, code: 'csrf_failed', message: t('common.form_expired') });
    // Never one POST away: the confirmation (modal with JavaScript, a page step without it) is enforced here.
    if (!confirmed(event)) return confirmFail(event.locals.locale.locale);
    const r = unwrap(await apiFor(event).v1.m.hello.notes({ id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/m/hello/notes?saved=deleted');
  },
};
