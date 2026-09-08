import { formToObject, validateForm, WebhookBody } from '@core/contracts';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const ev = await apiFor(event).v1.webhooks.events.get();
  if (!ev.data?.success) error(ev.status, 'Daftar event tidak bisa dimuat');
  return { events: ev.data.data.events };
};

export const actions: Actions = {
  default: async (event) => {
    const form = await event.request.formData();
    const raw = formToObject(form, { arrays: ['events'] });
    const input = { ...raw, enabled: raw.enabled !== undefined };
    if (!checkCsrf(event, form))
      return actionFailure(
        {
          status: 403,
          code: 'csrf_failed',
          message: 'Sesi formulir kedaluwarsa — muat ulang halaman',
        },
        raw,
      );
    const v = validateForm(WebhookBody, input);
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: 'Periksa isian yang ditandai',
          details: v.errors,
        },
        raw,
      );
    const r = unwrap<{ success: true; data: { id: string; secret: string } }>(
      await apiFor(event).v1.webhooks.post(v.value),
    );
    if (!r.ok) return actionFailure(r.failure, raw);
    // The secret is shown once, on the detail page, straight from this redirect.
    redirect(303, `/webhooks/${r.data.data.id}?secret=${encodeURIComponent(r.data.data.secret)}`);
  },
};
