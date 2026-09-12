import { json, type RequestHandler } from '@sveltejs/kit';
import { apiFor, checkCsrf, str } from '$lib/server/session';

/**
 * One model's capability probe over fetch, so a row of the price list fills in without reloading
 * the page — a probe takes seconds, and an admin testing five models should not lose the four
 * answers already on screen. Progressive enhancement only: the `?/testModel` form action does the
 * same thing with JavaScript off, and both call the same API endpoint.
 */
export const POST: RequestHandler = async (event) => {
  const form = await event.request.formData();
  if (!checkCsrf(event, form)) {
    return json(
      { ok: false, error: 'Sesi formulir kedaluwarsa — muat ulang halaman' },
      { status: 403 },
    );
  }
  const id = String(event.params.id ?? '');
  const res = await apiFor(event)
    .v1.m.ai.providers({ id })
    .models.test.post({ model: str(form, 'model') });
  const body = res.data as
    | { success: true; data: Record<string, unknown> }
    | { success: false; error?: { message?: string } }
    | null;
  if (!body?.success) {
    return json(
      {
        ok: false,
        error: (body as { error?: { message?: string } })?.error?.message ?? 'Uji koneksi gagal',
      },
      { status: res.status || 502 },
    );
  }
  return json(body.data);
};
