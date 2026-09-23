import { formToObject, validateForm } from '@core/contracts';
import { createTranslator, type Locale } from '@core/i18n';
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
  const t = createTranslator(event.locals.locale.locale);
  const id = String(event.params.id ?? '');
  const res = await apiFor(event).v1.m.ai.mcps({ id }).get();
  if (!res.data?.success) error(res.status === 404 ? 404 : res.status, t('ai.mcps.not_found'));
  return {
    mcp: res.data.data,
    saved: event.url.searchParams.has('saved'),
    /** Opens the delete confirmation; the action checks the same flag (see `confirmed`). */
    confirmDelete: confirmed(event),
  };
};

const csrfFail = (locale: Locale, values: Record<string, unknown> = {}) =>
  actionFailure(
    {
      status: 403,
      code: 'csrf_failed',
      message: createTranslator(locale)('common.form_expired'),
    },
    values,
  );

export const actions: Actions = {
  save: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    const raw = formToObject(form);
    const input = {
      ...raw,
      headers: parseHeaderLines(str(form, 'headers')),
      enabled: raw.enabled !== undefined,
    };
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale, raw);
    const v = validateForm(McpUpdateBody, input);
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: t('common.check_fields'),
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
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap<{
      success: true;
      data: {
        ok: boolean;
        error: string | null;
        ms: number;
        tools: {
          id: string;
          name: string;
          wireName: string;
          description: string | null;
          enabled: boolean;
        }[];
      };
    }>(await apiFor(event).v1.m.ai.mcps({ id }).test.post());
    if (!r.ok) return actionFailure(r.failure);
    return { tested: r.data.data };
  },
  /**
   * Which tools the assistant may use — the no-JavaScript path (L-22). The table is one form: every
   * listed tool posts its id under `ids`, every TICKED one also under `checked`, so the difference
   * is the set to disable. With JavaScript each checkbox saves itself over fetch (`tools/+server.ts`)
   * and this action is never reached; both call the same `PUT /v1/m/ai/mcps/:id/tools`.
   */
  tools: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const strings = (key: string) =>
      form.getAll(key).filter((v): v is string => typeof v === 'string' && v !== '');
    const listed = strings('ids');
    const checked = new Set(strings('checked'));
    const on = listed.filter((x) => checked.has(x));
    const off = listed.filter((x) => !checked.has(x));
    const api = apiFor(event).v1.m.ai.mcps({ id }).tools;
    // Two requests at most, and only for a non-empty set: the API refuses an empty `ids`.
    for (const [ids, enabled] of [
      [on, true],
      [off, false],
    ] as const) {
      if (ids.length === 0) continue;
      const r = unwrap(await api.put({ ids: [...ids], enabled }));
      if (!r.ok) return actionFailure(r.failure);
    }
    return { toolsSaved: true };
  },
  delete: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    if (!confirmed(event)) return confirmFail(event.locals.locale.locale);
    const r = unwrap(await apiFor(event).v1.m.ai.mcps({ id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/m/ai/mcps?saved=deleted');
  },
};
