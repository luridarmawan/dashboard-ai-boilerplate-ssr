import { createTranslator, type Locale } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/**
 * Email outbox monitoring (J-2): every row the worker has to deliver, newest first, with the
 * filters an operator actually reaches for — status, template, a day range and free-text search
 * over recipient and subject. Plain links and GET forms, so it works without JavaScript (L-22).
 */
const STATUSES = ['pending', 'sending', 'sent', 'failed'] as const;
type Status = (typeof STATUSES)[number];
const SORTS = ['created', 'sent', 'status', 'to', 'subject', 'template', 'attempts'] as const;
type Sort = (typeof SORTS)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The table is wide (seven columns plus the error line); give it the roomy shell. */
export const _layoutVariant = 'wide';

/** The filter state carried by the URL; every link and form on the page round-trips it. */
export interface OutboxFilters {
  q: string;
  status: string;
  template: string;
  from: string;
  to: string;
  sort: Sort;
  order: 'asc' | 'desc';
  limit: number;
}

function filtersFrom(url: URL): OutboxFilters {
  const get = (k: string) => url.searchParams.get(k)?.trim() ?? '';
  const status = get('status');
  const sort = get('sort');
  const order = get('order');
  const limit = Number(get('limit'));
  const day = (k: string) => (DAY.test(get(k)) ? get(k) : '');
  return {
    q: get('q').slice(0, 191),
    status: STATUSES.includes(status as Status) ? status : '',
    template: get('template').slice(0, 64),
    from: day('from'),
    to: day('to'),
    sort: SORTS.includes(sort as Sort) ? (sort as Sort) : 'created',
    order: order === 'asc' ? 'asc' : 'desc',
    limit: [20, 50, 100].includes(limit) ? limit : 50,
  };
}

export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const f = filtersFrom(event.url);
  const asked = Number(event.url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : 1;
  const api = apiFor(event);
  // The counts come from the whole outbox, not the filtered page: the chips are what an operator
  // uses to LEAVE the current filter, so they must not shrink with it.
  const [list, stats] = await Promise.all([
    api.v1.outbox.get({
      query: {
        page,
        limit: f.limit,
        sort: f.sort,
        order: f.order,
        ...(f.q ? { q: f.q } : {}),
        ...(f.status ? { status: f.status as Status } : {}),
        ...(f.template ? { template: f.template } : {}),
        ...(f.from ? { from: f.from } : {}),
        ...(f.to ? { to: f.to } : {}),
      },
    }),
    api.v1.outbox.stats.get(),
  ]);
  if (!list.data?.success)
    error(list.status, list.status === 403 ? t('outbox.forbidden') : t('outbox.load_failed'));
  return {
    // Eden revives date-like strings into Date objects on this side; the page renders strings.
    rows: list.data.data.map((r) => ({
      ...r,
      nextAttemptAt: r.nextAttemptAt ? new Date(r.nextAttemptAt).toISOString() : null,
      sentAt: r.sentAt ? new Date(r.sentAt).toISOString() : null,
      createdAt: new Date(r.createdAt).toISOString(),
    })),
    meta: list.data.meta,
    counts: stats.data?.success
      ? stats.data.data
      : { pending: 0, sending: 0, sent: 0, failed: 0, total: 0, templates: [] },
    filters: f,
    saved: event.url.searchParams.get('saved'),
    delivered: event.url.searchParams.get('delivered'),
  };
};

const csrfFail = (locale: Locale) =>
  actionFailure({
    status: 403,
    code: 'csrf_failed',
    message: createTranslator(locale)('common.form_expired'),
  });

/** Where to return after an action: the same filtered view the operator was looking at. */
const back = (form: FormData, extra: string) => {
  const query = str(form, 'query');
  return `/outbox?${extra}${query ? `&${query}` : ''}`;
};

export const actions: Actions = {
  retry: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap(
      await apiFor(event)
        .v1.outbox({ id: str(form, 'id') })
        .retry.post(),
    );
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, back(form, 'saved=retried'));
  },
  deliver: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return csrfFail(event.locals.locale.locale);
    const r = unwrap<{
      success: true;
      data: { picked: number; sent: number; failed: number; deferred: number };
    }>(await apiFor(event).v1.outbox.deliver.post());
    if (!r.ok) return actionFailure(r.failure);
    const d = r.data.data;
    // The summary rides back in the URL so the redirect target renders it without a flash store.
    redirect(303, back(form, `delivered=${d.picked}.${d.sent}.${d.failed}.${d.deferred}`));
  },
};
