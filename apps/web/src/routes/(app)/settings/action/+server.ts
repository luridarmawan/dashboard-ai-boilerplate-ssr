import { json, type RequestHandler } from '@sveltejs/kit';
import { apiFor, apiPostData, checkCsrf } from '$lib/server/session';

/**
 * A failure this endpoint itself decided: the page renders `i18n` from its catalogue, and
 * `message` only survives as what a build without that key would show.
 */
const refused = (message: string, i18n: string) => ({ ok: false as const, message, i18n });

/**
 * A failure the API returned. Its `message` is Indonesian by contract (K-*), so a route that wants
 * the operator's language declares `details.i18n` — a message key — and the remaining string
 * fields of `details` become its `{placeholders}`. Without such a key the API's own message
 * stands: it is more specific than anything generic this endpoint could put in its place.
 */
function fromApi(message: string | null, details: unknown) {
  const d = (details ?? null) as Record<string, unknown> | null;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(d ?? {})) {
    if (k !== 'i18n' && k !== 'reason' && typeof v === 'string') params[k] = v;
  }
  const declared = typeof d?.i18n === 'string' ? d.i18n : null;
  return {
    ok: false as const,
    message: message ?? '',
    i18n: declared ?? (message ? undefined : 'settings.action_failed'),
    params,
  };
}

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
    return json(refused('Sesi formulir kedaluwarsa — muat ulang halaman', 'common.form_expired'), {
      status: 403,
    });
  }
  const section = String(form.get('section') ?? '');
  const key = String(form.get('action') ?? '');
  const scope = String(form.get('scope') ?? '') === 'global' ? 'global' : 'tenant';

  const res = await apiFor(event).v1.configuration.get({
    query: scope === 'global' ? { scope: 'global' } : {},
  });
  if (!res.data?.success) {
    return json(refused('Pengaturan tidak bisa dibaca', 'settings.action_config_unreadable'), {
      status: res.status,
    });
  }
  const declared = res.data.data.sections
    .find((s) => s.section === section)
    ?.actions.find((a) => a.key === key);
  if (!declared) {
    return json(refused('Aksi tidak dikenal', 'settings.action_unknown'), { status: 404 });
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
    return json(fromApi(r.error, r.details), {
      status: r.status,
    });
  }
  return json({ ok: r.data.ok, message: r.data.message, details: r.data.details ?? [] });
};
