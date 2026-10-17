import { formToObject, validateForm } from '@core/contracts';
import { createTranslator } from '@core/i18n';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { shareImage } from '$lib/server/seo';
import {
  actionFailure,
  apiFor,
  checkCsrf,
  confirmed,
  confirmFail,
  unwrap,
} from '$lib/server/session';
import { PageUpdateBody, SlugBody } from '../../../../api/schemas.ts';
import { slugError } from '../_form.ts';

/** Eden revives ISO strings into Dates; the page prints these, so keep them strings. */
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''));

export const load: ServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const id = String(event.params.id ?? '');
  const res = await apiFor(event).v1.m.pages.pages({ id }).get();
  if (!res.data?.success) error(res.status === 404 ? 404 : res.status, t('pages.list.not_found'));
  const row = res.data.data;
  return {
    row: {
      ...row,
      redirects: row.redirects.map((r) => ({ oldSlug: r.oldSlug, createdAt: iso(r.createdAt) })),
    },
    origin: event.url.origin,
    /** What the share preview shows while the page has no image: the site's default share image. */
    shareDefault: (await shareImage(event)).url,
    /** Root URLs only answer while this module is the 404 handler; the page says so when it is not. */
    serving: event.locals.config.values['app.not_found_route'] === '/pages',
    saved: event.url.searchParams.has('saved'),
    /** `confirmDelete` opens the delete confirmation; the action below checks the same flag. */
    confirmDelete: confirmed(event),
  };
};

export const actions: Actions = {
  save: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    const raw = formToObject(form, { nullable: ['summary', 'body'] });
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        raw,
      );
    const v = validateForm(PageUpdateBody, raw);
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
    const r = unwrap(await apiFor(event).v1.m.pages.pages({ id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, raw);
    return { saved: true };
  },
  /**
   * The permalink form. With JavaScript it is posted over fetch (see +page.svelte) and the page
   * updates in place; without it, the same action answers with a full page and a notice.
   */
  slug: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    const raw = formToObject(form);
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        raw,
        { slugForm: true },
      );
    const v = validateForm(SlugBody, raw);
    if (!v.ok)
      return actionFailure(
        {
          status: 422,
          code: 'validation_failed',
          message: t('common.check_fields'),
          details: { slug: t('pages.err.slug_format') },
        },
        raw,
        { slugForm: true },
      );
    const r = unwrap<{
      success: true;
      data: { change: { changed: boolean; redirected: boolean; from: string; to: string } };
    }>(await apiFor(event).v1.m.pages.pages({ id }).slug.put(v.value));
    if (!r.ok) {
      const field = slugError(t, r.failure.details);
      return actionFailure(
        field ? { ...r.failure, message: t('common.check_fields'), details: field } : r.failure,
        raw,
        { slugForm: true },
      );
    }
    return { slugChange: r.data.data.change };
  },
  /**
   * The featured image card: a new file (with its alt) goes up as multipart; without a file the
   * same form just saves the alt text. Errors come back in the reader's language, mapped from the
   * API's `details.reason`.
   */
  image: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    const alt = String(form.get('alt') ?? '').trim();
    const back = { alt };
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        back,
        { imageForm: true },
      );
    const file = form.get('file');
    const api = apiFor(event).v1.m.pages.pages({ id });
    const r =
      file instanceof File && file.size > 0
        ? unwrap(await api.image.post({ file, alt }))
        : unwrap(await api.put({ imageAlt: alt || null }));
    if (!r.ok) {
      const reason = (r.failure.details as { reason?: unknown } | null)?.reason;
      const known = ['too_large', 'type_not_allowed', 'content_mismatch', 'empty'];
      const message =
        typeof reason === 'string' && known.includes(reason)
          ? t(`pages.image.err.${reason as 'too_large'}`)
          : r.failure.status === 413
            ? t('pages.image.err.too_large')
            : r.failure.message;
      return actionFailure({ ...r.failure, message }, back, { imageForm: true });
    }
    return { imageSaved: file instanceof File && file.size > 0 ? 'uploaded' : 'alt' };
  },
  imageRemove: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form))
      return actionFailure(
        { status: 403, code: 'csrf_failed', message: t('common.form_expired') },
        {},
        { imageForm: true },
      );
    const r = unwrap(await apiFor(event).v1.m.pages.pages({ id }).image.delete());
    if (!r.ok) return actionFailure(r.failure, {}, { imageForm: true });
    return { imageSaved: 'removed' };
  },
  delete: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    const id = String(event.params.id ?? '');
    if (!checkCsrf(event, form))
      return actionFailure({ status: 403, code: 'csrf_failed', message: t('common.form_expired') });
    // Never one POST away: the confirmation (modal with JavaScript, a page step without it) is enforced here.
    if (!confirmed(event)) return confirmFail(event.locals.locale.locale);
    const r = unwrap(await apiFor(event).v1.m.pages.pages({ id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/m/pages/pages?saved=deleted');
  },
};
