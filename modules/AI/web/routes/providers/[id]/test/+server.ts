import { json, type RequestHandler } from '@sveltejs/kit';
import { apiFor, checkCsrf } from '$lib/server/session';

/**
 * The capability probe over fetch, so the admin card fills in without a page load. Progressive
 * enhancement only: the `?/test` form action is still there and still works with JavaScript off,
 * and both call exactly the same API endpoint — this route adds no behaviour of its own.
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
  const res = await apiFor(event).v1.m.ai.providers({ id }).test.post();
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
