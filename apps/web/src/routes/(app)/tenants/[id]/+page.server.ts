import { ClientUpdateBody, formToObject, validateForm } from '@core/contracts';
import { createTranslator } from '@core/i18n';
import { error, redirect } from '@sveltejs/kit';
import { regionChain, regionOptions } from '$lib/server/regions';
import { actionFailure, apiFor, checkCsrf, str, unwrap } from '$lib/server/session';
import { parentCandidates, parentOptions } from '$lib/server/tenants';
import type { Actions, PageServerLoad } from './$types';

/**
 * Profile fields of the edit form: an empty box clears the column (null), so they are all
 * nullable in `formToObject`. The ledger amounts are not on the form — they are groundwork for
 * later features and only move through the API.
 */
const PROFILE_FIELDS = [
  'description',
  'url',
  'mapsUrl',
  'address',
  'rt',
  'rw',
  'postalCode',
  'kelurahan',
  'kelurahanId',
  'kecamatan',
  'kecamatanId',
  'city',
  'cityId',
  'regency',
  'province',
  'provinceId',
  'region',
  'regionId',
  'countryId',
  'latitude',
  'longitude',
] as const;

/**
 * The region picker: province → regency/city → district → village, as codes. Posted without the
 * names — the API fills those from the regions table — and only when that table has data.
 */
const REGION_IDS = ['provinceId', 'cityId', 'kecamatanId', 'kelurahanId'] as const;
const REGION_NAMES = ['province', 'city', 'kecamatan', 'kelurahan'] as const;

export const load: PageServerLoad = async (event) => {
  const t = createTranslator(event.locals.locale.locale);
  const res = await apiFor(event).v1.clients({ id: event.params.id }).get();
  if (!res.data?.success)
    error(res.status === 404 ? 404 : res.status, t('tenants.detail.not_found'));
  const client = res.data.data;
  // One request for the provinces tells whether region data is loaded at all; without it the
  // form keeps plain text boxes. Deeper levels load only under a chosen parent.
  const provinces = await regionOptions(event);
  const picker = provinces.length > 0;
  const [cities, districts, villages] = picker
    ? await Promise.all([
        regionOptions(event, client.provinceId),
        regionOptions(event, client.cityId),
        regionOptions(event, client.kecamatanId),
      ])
    : [[], [], []];
  return {
    client,
    regions: { picker, provinces, cities, districts, villages },
    // Parent choices: never the tenant itself or anything under it (that would close a loop).
    parents: parentOptions(await parentCandidates(event, event.params.id)),
    /**
     * Deleting a tenant is the most destructive act in the app, so it takes two steps: `?confirm=delete`
     * opens the confirmation (a plain link — no JavaScript needed, L-22), and the action below still
     * refuses a POST whose typed code does not match. The URL survives a failed action, so the
     * confirmation stays open with its message.
     */
    confirmDelete: event.url.searchParams.get('confirm') === 'delete',
  };
};

export const actions: Actions = {
  save: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: t('common.form_expired'),
      });
    }
    // An empty parent choice means "top level": null clears the parent, it is not a missing field.
    const raw = formToObject(form, { nullable: ['parentId', ...PROFILE_FIELDS] });
    const profile: Record<string, unknown> = Object.fromEntries(
      PROFILE_FIELDS.map((k) => [k, raw[k] ?? null]),
    );
    if (form.has('_regionPicker')) {
      // Picker mode: the names are not on the form — the API fills them — and a level that no
      // longer sits under its parent (the parent changed) is cleared with everything below it.
      const chain = regionChain(REGION_IDS.map((k) => raw[k] as string | null | undefined));
      REGION_IDS.forEach((k, i) => {
        profile[k] = chain[i];
      });
      for (const k of REGION_NAMES) delete profile[k];
    }
    const v = validateForm(ClientUpdateBody, {
      name: raw.name,
      parentId: raw.parentId ?? null,
      statusId: raw.active !== undefined ? 1 : 0,
      ...profile,
    });
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
    const r = unwrap(await apiFor(event).v1.clients({ id: event.params.id }).put(v.value));
    if (!r.ok) return actionFailure(r.failure, raw);
    return { saved: true };
  },
  delete: async (event) => {
    const t = createTranslator(event.locals.locale.locale);
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) {
      return actionFailure({
        status: 403,
        code: 'csrf_failed',
        message: t('common.form_expired'),
      });
    }
    // The confirmation is enforced HERE, not only in the markup: the caller must type the tenant's
    // own code, which is read back from the API rather than from a hidden field a client could edit.
    const current = await apiFor(event).v1.clients({ id: event.params.id }).get();
    if (!current.data?.success)
      error(current.status === 404 ? 404 : current.status, t('tenants.detail.not_found'));
    if (str(form, 'code').trim() !== current.data.data.code)
      return actionFailure({
        status: 422,
        code: 'confirm_failed',
        message: t('tenants.detail.delete_confirm_mismatch'),
      });
    const r = unwrap(await apiFor(event).v1.clients({ id: event.params.id }).delete());
    if (!r.ok) return actionFailure(r.failure);
    redirect(303, '/tenants');
  },
};
