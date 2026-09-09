import { json, type RequestHandler } from '@sveltejs/kit';
import { apiFor, apiPostData, checkCsrf } from '$lib/server/session';

/**
 * Runs a config section's action (extension point 6) without leaving the page — "test connection"
 * and its kin. The browser sends only the SECTION and the ACTION KEY; the endpoint to call is
 * looked up from the section metadata the API itself reports, never taken from the request. That
 * is what keeps this from being an open proxy into the API.
 *
 * The button is progressive enhancement: without JavaScript the section simply has no action, so
 * nothing here is on the critical path of saving settings.
 */
export const POST: RequestHandler = async (event) => {
  const form = await event.request.formData();
  if (!checkCsrf(event, form)) {
    return json(
      { ok: false, message: 'Sesi formulir kedaluwarsa — muat ulang halaman' },
      { status: 403 },
    );
  }
  const section = String(form.get('section') ?? '');
  const key = String(form.get('action') ?? '');
  const scope = String(form.get('scope') ?? '') === 'global' ? 'global' : 'tenant';

  const res = await apiFor(event).v1.configuration.get({
    query: scope === 'global' ? { scope: 'global' } : {},
  });
  if (!res.data?.success) {
    return json({ ok: false, message: 'Pengaturan tidak bisa dibaca' }, { status: res.status });
  }
  const declared = res.data.data.sections
    .find((s) => s.section === section)
    ?.actions.find((a) => a.key === key);
  if (!declared) {
    return json({ ok: false, message: 'Aksi tidak dikenal' }, { status: 404 });
  }

  const r = await apiPostData<{ ok: boolean; message: string; details?: string[] }>(
    event,
    declared.endpoint,
  );
  if (!r.data) {
    return json({ ok: false, message: r.error ?? 'Aksi gagal' }, { status: r.status });
  }
  return json({ ok: r.data.ok, message: r.data.message, details: r.data.details ?? [] });
};
