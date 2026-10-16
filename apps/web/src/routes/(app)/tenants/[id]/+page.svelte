<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import { type FieldDef, FormBuilder } from '$lib/components/form';
import Icon from '$lib/components/Icon.svelte';
import { Alert, Badge, Button, Card, Field, Input } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
import type { LayoutData } from '../../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const locale = useLocale();
const can = (p: string) => data.user.isSuperadmin || hasPermission(data.permissions, p);
const c = $derived(data.client);
/** Decimal strings from the API, shown as plain numbers in the viewer's locale. */
const amount = (s: string) =>
  new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'id-ID', { maximumFractionDigits: 4 }).format(
    Number(s),
  );
const text = (name: string, label: string, maxlength: number): FieldDef => ({
  name,
  type: 'string',
  label,
  maxlength,
});
/** Opaque region code next to its name: same row, half width each. */
const regionId = (name: string, label: string): FieldDef => ({
  name,
  type: 'string',
  label,
  maxlength: 32,
  pattern: '[A-Za-z0-9._\\-]*',
  autocomplete: 'off',
});
const r = $derived(data.regions);
/** A picker level: its options come from `load`; empty until the level above is chosen. */
const level = (
  name: string,
  label: string,
  options: { value: string; label: string }[],
): FieldDef => ({
  name,
  type: 'select',
  label,
  options,
  ...(options.length ? {} : { hint: t('tenants.region_pick_parent') }),
});
/**
 * With region data loaded: four linked pickers that post codes only (the API fills the names).
 * Without it: the free-text name + code pairs, as before.
 */
const addressFields: FieldDef[] = $derived(
  r.picker
    ? [
        { name: '_regionPicker', type: 'hidden' },
        level('provinceId', t('tenants.province'), r.provinces),
        level('cityId', t('tenants.city_picker'), r.cities),
        level('kecamatanId', t('tenants.kecamatan'), r.districts),
        level('kelurahanId', t('tenants.kelurahan'), r.villages),
        text('region', t('tenants.region'), 191),
        regionId('regionId', t('tenants.region_id')),
        { ...text('regency', t('tenants.regency'), 191), span: 2 },
      ]
    : [
        text('kelurahan', t('tenants.kelurahan'), 191),
        regionId('kelurahanId', t('tenants.kelurahan_id')),
        text('kecamatan', t('tenants.kecamatan'), 191),
        regionId('kecamatanId', t('tenants.kecamatan_id')),
        text('city', t('tenants.city'), 191),
        regionId('cityId', t('tenants.city_id')),
        text('province', t('tenants.province'), 191),
        regionId('provinceId', t('tenants.province_id')),
        text('region', t('tenants.region'), 191),
        regionId('regionId', t('tenants.region_id')),
        { ...text('regency', t('tenants.regency'), 191), span: 2 },
      ],
);
const fields: FieldDef[] = $derived([
  { name: 'name', type: 'string', label: t('tenants.name'), required: true, maxlength: 191 },
  {
    name: 'parentId',
    type: 'select',
    label: t('tenants.parent'),
    hint: t('tenants.parent_hint'),
    options: data.parents,
  },
  {
    name: 'referenceId',
    type: 'string',
    label: t('tenants.reference_id'),
    hint: t('tenants.reference_id_hint'),
    maxlength: 191,
    autocomplete: 'off',
  },
  { name: 'joinDate', type: 'date', label: t('tenants.join_date') },
  { name: 'description', type: 'text', label: t('tenants.description'), maxlength: 2000, span: 2 },
  { ...text('url', t('tenants.url'), 2048), type: 'string', autocomplete: 'url' },
  { ...text('mapsUrl', t('tenants.maps_url'), 2048), autocomplete: 'url' },
  { name: 'address', type: 'text', label: t('tenants.address'), maxlength: 2000, rows: 2, span: 2 },
  text('rt', t('tenants.rt'), 8),
  text('rw', t('tenants.rw'), 8),
  {
    name: 'postalCode',
    type: 'string',
    label: t('tenants.postal_code'),
    maxlength: 10,
    pattern: '[A-Za-z0-9 -]{3,10}',
    autocomplete: 'postal-code',
  },
  regionId('countryId', t('tenants.country_id')),
  ...addressFields,
  {
    name: 'latitude',
    type: 'string',
    label: t('tenants.latitude'),
    maxlength: 24,
    placeholder: '-6.2000000',
  },
  {
    name: 'longitude',
    type: 'string',
    label: t('tenants.longitude'),
    maxlength: 24,
    placeholder: '106.8166667',
  },
  { name: 'active', type: 'boolean', label: t('tenants.detail.active'), span: 2 },
]);
const values = $derived({
  name: c.name,
  parentId: c.parentId ?? '',
  description: c.description,
  referenceId: c.referenceId,
  joinDate: c.joinDate,
  url: c.url,
  mapsUrl: c.mapsUrl,
  address: c.address,
  rt: c.rt,
  rw: c.rw,
  postalCode: c.postalCode,
  kelurahan: c.kelurahan,
  kelurahanId: c.kelurahanId,
  kecamatan: c.kecamatan,
  kecamatanId: c.kecamatanId,
  city: c.city,
  cityId: c.cityId,
  regency: c.regency,
  province: c.province,
  provinceId: c.provinceId,
  region: c.region,
  regionId: c.regionId,
  countryId: c.countryId,
  latitude: c.latitude,
  longitude: c.longitude,
  active: c.statusId === 1,
  _regionPicker: '1',
});

/**
 * Progressive enhancement of the region picker: with JavaScript, choosing a level loads the next
 * one at once and empties everything below it. Without JavaScript the same form still works —
 * save, and `load` fills the next level from the saved choice; the action drops stale levels.
 */
const CHAIN = ['provinceId', 'cityId', 'kecamatanId', 'kelurahanId'];
function cascade(root: HTMLElement) {
  const select = (name: string) => root.querySelector<HTMLSelectElement>(`#f-${name}`);
  const reset = (el: HTMLSelectElement, options: { value: string; label: string }[]) => {
    el.replaceChildren(new Option('—', ''), ...options.map((o) => new Option(o.label, o.value)));
  };
  const onChange = async (e: Event) => {
    const el = e.target as HTMLSelectElement;
    const i = CHAIN.indexOf(el.name);
    if (i < 0 || i === CHAIN.length - 1) return;
    for (const name of CHAIN.slice(i + 1)) {
      const below = select(name);
      if (below) reset(below, []);
    }
    const next = select(CHAIN[i + 1] as string);
    if (!next || !el.value) return;
    const res = await fetch(`/regions?parent=${encodeURIComponent(el.value)}`);
    if (res.ok) reset(next, await res.json());
  };
  root.addEventListener('change', onChange);
  return { destroy: () => root.removeEventListener('change', onChange) };
}
/** Open on `?confirm=delete`, and stay open when the action bounced the typed code back. */
const confirming = $derived(data.confirmDelete || form?.code === 'confirm_failed');
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
</script>

<svelte:head><title>{t('tenants.detail.title', { name: c.name })}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center gap-3"><h1>{c.name}</h1><code>{c.code}</code><Badge variant={c.statusId === 1 ? 'success' : 'secondary'}>{c.statusId === 1 ? t('common.active') : t('common.inactive')}</Badge></div>
  <div class="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
    {#if c.parent}
      <p>{t('tenants.parent')}: <a href="/tenants/{c.parent.id}" class="text-foreground">{c.parent.name}</a> <code>{c.parent.code}</code></p>
    {/if}
    <!-- Ledger amounts are groundwork: shown, but only the API moves them. -->
    <p>{t('tenants.balance')}: <span class="text-foreground">{amount(c.balance)}</span></p>
    <p>{t('tenants.total_receipts')}: <span class="text-foreground">{amount(c.totalReceipts)}</span></p>
  </div>
  <div use:cascade><Card>
    <FormBuilder {fields} {values} columns={2} errors={fieldErrors} csrf={data.csrf} action="?/save" readonly={!can('client.edit')} cancelHref="/tenants" cancelLabel={t('common.back')} notice={form?.saved ? t('common.saved') : null} error={form?.error && Object.keys(fieldErrors).length === 0 ? form.error : null} />
  </Card></div>
  {#if can('client.manage') && c.code !== 'default'}
    <Card title={t('tenants.detail.delete')} description={t('tenants.detail.delete_hint')}>
      {#if confirming}
        <!-- Two-step confirmation (no JavaScript required): the code has to be typed, and the action checks it again. -->
        <div class="grid gap-4" id="delete">
          <Alert variant="error" title={t('tenants.detail.delete_confirm')}>
            <p>{t('tenants.detail.delete_confirm_lead', { name: c.name })}</p>
          </Alert>
          <form method="POST" action="?/delete&confirm=delete" class="grid gap-4">
            <Csrf token={data.csrf} />
            <Field label={t('tenants.detail.delete_confirm_code', { code: c.code })} for="confirm-code" error={form?.code === 'confirm_failed' ? form.error : null} required>
              <Input id="confirm-code" name="code" autocomplete="off" autocapitalize="none" spellcheck={false} required />
            </Field>
            <div class="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive"><Icon name="trash" size={16} />{t('tenants.detail.delete_confirm_submit')}</Button>
              <Button href="/tenants/{c.id}" variant="secondary">{t('common.cancel')}</Button>
            </div>
          </form>
        </div>
      {:else}
        <Button href="/tenants/{c.id}?confirm=delete#delete" variant="destructive"><Icon name="trash" size={16} />{t('tenants.detail.delete')}</Button>
      {/if}
    </Card>
  {/if}
</div>
