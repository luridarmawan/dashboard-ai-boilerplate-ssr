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
import type { ProbeResult } from '../../../../api/probe.ts';
import { ProviderUpdateBody } from '../../../../api/schemas.ts';
import { parseModelLines } from '../_form.ts';

export const load: ServerLoad = async (event) => {
  const id = String(event.params.id ?? '');
  const res = await apiFor(event).v1.m.ai.providers({ id }).get();
  if (!res.data?.success)
    error(res.status === 404 ? 404 : res.status, 'Penyedia AI tidak ditemukan');
  return {
    provider: res.data.data,
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
    const apiKey = str(form, 'apiKey');
    // An empty key field means "keep" — the API's own `***` convention.
    const input = {
      ...raw,
      apiKey: apiKey || '***',
      models: parseModelLines(str(form, 'models')),
      enabled: raw.enabled !== undefined,
      isDefault: raw.isDefault !== undefined,
    };
    const values = { ...raw, apiKey: '' };
    if (!checkCsrf(event, form)) return csrfFail(values);
    const v = validateForm(ProviderUpdateBody, input);
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: 'Periksa isian yang ditandai',
          details: v.errors,
        },
        values,
      );
    const r = unwrap(await apiFor(event).v1.m.ai.providers({ id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, values);
    return { saved: true };
  },
  /** Capability probe with the stored key (AI-Roadmap §4.1): endpoints, stream, reasoning, tools. */
  test: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap<{
      success: true;
      data: {
        ok: boolean;
        error: string | null;
        models: string[];
        ms: number;
        capabilities: Omit<ProbeResult, 'ok' | 'error' | 'ms' | 'steps'>;
        preferredEndpoint: string | null;
        recommended: boolean;
        steps: ProbeResult['steps'];
      };
    }>(await apiFor(event).v1.m.ai.providers({ id }).test.post());
    if (!r.ok) return actionFailure(r.failure);
    return { tested: r.data.data };
  },
  /**
   * The same probe for ONE model of the price list (a provider's models do not share one spec).
   * The no-JavaScript path: `model-test/+server.ts` is the enhanced one, and both call the same
   * API route, so the verdict and what gets stored are identical either way.
   */
  testModel: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail();
    const r = unwrap<{
      success: true;
      data: {
        model: string;
        ok: boolean;
        error: string | null;
        ms: number;
        capabilities: Omit<ProbeResult, 'ok' | 'error' | 'ms' | 'steps'>;
        preferredEndpoint: string | null;
        recommended: boolean;
        testedAt: string;
        steps: ProbeResult['steps'];
      };
    }>(
      await apiFor(event)
        .v1.m.ai.providers({ id })
        .models.test.post({ model: str(form, 'model') }),
    );
    if (!r.ok) return actionFailure(r.failure);
    return { testedModel: r.data.data };
  },
  delete: async (event) => {
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form)) return csrfFail();
    if (!confirmed(event)) return confirmFail(event.locals.locale.locale);
    const r = unwrap(await apiFor(event).v1.m.ai.providers({ id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/m/ai/providers?saved=deleted');
  },
};
