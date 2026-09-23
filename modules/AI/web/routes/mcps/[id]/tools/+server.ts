import { createTranslator } from '@core/i18n';
import { json, type RequestHandler } from '@sveltejs/kit';
import { apiFor, checkCsrf } from '$lib/server/session';

/**
 * Enable or disable tools of one MCP server over fetch, so ticking a checkbox saves at once and
 * the table never needs a save button. Progressive enhancement only (L-20 over L-22): the `?/tools`
 * form action still applies the same choice from a plain form post, and both call exactly the same
 * API endpoint — `PUT /v1/m/ai/mcps/:id/tools` — which is the only place the decision is stored.
 *
 * The browser sends `ids` (one per checkbox touched) and one `enabled` flag; the answer is the
 * server's CURRENT tool list, so the page redraws from the truth rather than from what it asked.
 */
export const POST: RequestHandler = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const form = await event.request.formData();
  if (!checkCsrf(event, form)) {
    return json({ ok: false, error: t('common.form_expired') }, { status: 403 });
  }
  const id = String(event.params.id ?? '');
  const ids = form
    .getAll('ids')
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .slice(0, 500);
  const enabled = String(form.get('enabled') ?? '') === 'true';
  if (ids.length === 0) {
    return json({ ok: false, error: t('ai.mcps.tools_none_selected') }, { status: 422 });
  }
  const res = await apiFor(event).v1.m.ai.mcps({ id }).tools.put({ ids, enabled });
  const body = res.data as
    | { success: true; data: { updated: number; tools: unknown[] } }
    | { success: false; error?: { message?: string } }
    | null;
  if (!body?.success) {
    return json(
      {
        ok: false,
        error:
          (body as { error?: { message?: string } })?.error?.message ??
          t('ai.mcps.tools_save_failed'),
      },
      { status: res.status || 502 },
    );
  }
  return json({ ok: true, ...body.data });
};
