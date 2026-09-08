import { formToObject, validateForm, WebhookUpdateBody } from '@core/contracts';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const id = String(event.params.id ?? '');
  const api = apiFor(event);
  const [res, ev] = await Promise.all([
    api.v1.webhooks({ id }).get(),
    api.v1.webhooks.events.get(),
  ]);
  if (!res.data?.success) error(res.status === 404 ? 404 : res.status, 'Webhook tidak ditemukan');
  return {
    webhook: res.data.data,
    events: ev.data?.success ? ev.data.data.events : [],
    // Shown once: arrives via the redirect from "new" or from rotate; never stored in the page.
    secret: event.url.searchParams.get('secret'),
    saved: event.url.searchParams.has('saved'),
  };
};

const csrfFail = (values: Record<string, unknown> = {}) =>
  actionFailure(
    { status: 403, code: 'csrf_failed', message: 'Sesi formulir kedaluwarsa — muat ulang halaman' },
    values,
  );

export const actions: Actions = {
  save: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    const raw = formToObject(form, { arrays: ['events'] });
    const input = { ...raw, enabled: raw.enabled !== undefined };
    if (!checkCsrf(event, form)) return csrfFail(raw);
    const v = validateForm(WebhookUpdateBody, input);
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
    const r = unwrap(await apiFor(event).v1.webhooks({ id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, raw);
    return { saved: true };
  },
  test: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap<{
      success: true;
      data: { ok: boolean; status: number | null; error: string | null; ms: number };
    }>(await apiFor(event).v1.webhooks({ id }).test.post());
    if (!r.ok) return actionFailure(r.failure);
    return { tested: r.data.data };
  },
  rotate: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap<{ success: true; data: { secret: string } }>(
      await apiFor(event).v1.webhooks({ id })['rotate-secret'].post(),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, `/webhooks/${id}?secret=${encodeURIComponent(r.data.data.secret)}`);
  },
  retry: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap(
      await apiFor(event)
        .v1.webhooks({ id })
        .deliveries({ deliveryId: str(form, 'deliveryId') })
        .retry.post(),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { retried: true };
  },
  delete: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap(await apiFor(event).v1.webhooks({ id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/webhooks?saved=deleted');
  },
};
