import { createTranslator } from '@core/i18n';
import { json, type RequestHandler } from '@sveltejs/kit';
import { apiFor, checkCsrf } from '$lib/server/session';

/**
 * Connect to the MCP server and (re)load its tool list over fetch, so the tools table refreshes
 * in place instead of through a page load. Progressive enhancement only (L-20 over L-22): the
 * `?/test` form action is still there and still works with JavaScript off, and both call exactly
 * the same API endpoint — this route adds no behaviour of its own, only a JSON answer.
 */
export const POST: RequestHandler = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const form = await event.request.formData();
  if (!checkCsrf(event, form)) {
    return json({ ok: false, error: t('common.form_expired') }, { status: 403 });
  }
  const id = String(event.params.id ?? '');
  const res = await apiFor(event).v1.m.ai.mcps({ id }).test.post();
  const body = res.data as
    | { success: true; data: Record<string, unknown> }
    | { success: false; error?: { message?: string } }
    | null;
  if (!body?.success) {
    return json(
      {
        ok: false,
        error:
          (body as { error?: { message?: string } })?.error?.message ?? t('ai.mcps.tested_fail'),
      },
      { status: res.status || 502 },
    );
  }
  return json(body.data);
};
