import { createTranslator, type Locale } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Job queue (P2): what is pending, running, done and dead-lettered in my scope. */
export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const status = event.url.searchParams.get('status');
  const ok = ['pending', 'running', 'done', 'dead'] as const;
  const res = await apiFor(event).v1.queue.get({
    query: {
      ...(ok.includes(status as (typeof ok)[number])
        ? { status: status as (typeof ok)[number] }
        : {}),
      limit: '100',
    },
  });
  if (!res.data?.success)
    error(res.status, res.status === 403 ? t('queue.forbidden') : t('queue.load_failed'));
  return { ...res.data.data, status: status ?? '', saved: event.url.searchParams.get('saved') };
};

const csrfFail = (locale: Locale) =>
  actionFailure({
    status: 403,
    code: 'csrf_failed',
    message: createTranslator(locale)('common.form_expired'),
  });

export const actions: Actions = {
  retry: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap(
      await apiFor(event)
        .v1.queue({ id: str(form, 'id') })
        .retry.post(),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(
      303,
      `/queue?saved=retried${str(form, 'status') ? `&status=${str(form, 'status')}` : ''}`,
    );
  },
  delete: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap(
      await apiFor(event)
        .v1.queue({ id: str(form, 'id') })
        .delete(),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(
      303,
      `/queue?saved=deleted${str(form, 'status') ? `&status=${str(form, 'status')}` : ''}`,
    );
  },
};
