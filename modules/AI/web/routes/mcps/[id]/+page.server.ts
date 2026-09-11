import { formToObject, validateForm } from '@core/contracts';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import {
  actionFailure,
  apiFor,
  checkCsrf,
  confirmed,
  confirmFail,
  str,
  unwrap,
} from '$lib/server/session';
import { McpUpdateBody } from '../../../../api/schemas.ts';
import { parseHeaderLines } from '../_form.ts';

export const load: ServerLoad = async (event) => {
  const id = String(event.params.id ?? '');
  const res = await apiFor(event).v1.m.ai.mcps({ id }).get();
  if (!res.data?.success)
    error(res.status === 404 ? 404 : res.status, 'Server MCP tidak ditemukan');
  return {
    mcp: res.data.data,
    saved: event.url.searchParams.has('saved'),
    /** Opens the delete confirmation; the action checks the same flag (see `confirmed`). */
    confirmDelete: confirmed(event),
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
    const raw = formToObject(form);
    const input = {
      ...raw,
      headers: parseHeaderLines(str(form, 'headers')),
      enabled: raw.enabled !== undefined,
    };
    if (!checkCsrf(event, form)) return csrfFail(raw);
    const v = validateForm(McpUpdateBody, input);
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
    const r = unwrap(await apiFor(event).v1.m.ai.mcps({ id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, raw);
    return { saved: true };
  },
  /** Connect, (re)load the tool list, record status (I-5). */
  test: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap<{
      success: true;
      data: {
        ok: boolean;
        error: string | null;
        ms: number;
        tools: { id: string; name: string; wireName: string; description: string | null }[];
      };
    }>(await apiFor(event).v1.m.ai.mcps({ id }).test.post());
    if (!r.ok) return actionFailure(r.failure);
    return { tested: r.data.data };
  },
  delete: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail();
    if (!confirmed(event)) return confirmFail(event.locals.locale.locale);
    const r = unwrap(await apiFor(event).v1.m.ai.mcps({ id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/m/ai/mcps?saved=deleted');
  },
};
