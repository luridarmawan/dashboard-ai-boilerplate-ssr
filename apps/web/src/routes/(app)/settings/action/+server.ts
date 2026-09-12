import { json, type RequestHandler } from '@sveltejs/kit';
import { apiFor, apiPostData, checkCsrf } from '$lib/server/session';

/**
 * Runs a config section's action (extension point 6) without leaving the page — "test connection",
 * "send a test e-mail" and their kin. The browser sends only the SECTION, the ACTION KEY and, when
 * the action declares one, the single INPUT value; the endpoint to call is looked up from the
 * section metadata the API itself reports, never taken from the request. That is what keeps this
 * from being an open proxy into the API — and the input is posted under the field name the
 * metadata declares, so the browser cannot name a field of its own either.
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

  // The scope travels with the action: a global-scope button must test the global configuration,
  // not the tenant the session happens to be on. Endpoints that do not care simply ignore it.
  const body: Record<string, string> = { scope };
  if (declared.input) {
    const value = form.get(`input.${declared.input.key}`);
    body[declared.input.key] = typeof value === 'string' ? value.slice(0, 2000) : '';
  }
  const r = await apiPostData<{ ok: boolean; message: string; details?: string[] }>(
    event,
    declared.endpoint,
    body,
  );
  if (!r.data) {
    return json({ ok: false, message: r.error ?? 'Aksi gagal' }, { status: r.status });
  }
  return json({ ok: r.data.ok, message: r.data.message, details: r.data.details ?? [] });
};
