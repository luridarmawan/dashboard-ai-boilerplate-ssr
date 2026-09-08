<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, Checkbox, Field, Input, Select, Textarea } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import type { LayoutData } from '../$types';
import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData & LayoutData; form: ActionData } = $props();
const t = useT();
const locale = useLocale() === 'en' ? 'en' : 'id';
const L = (v: { id: string; en: string } | null | undefined) => (v ? v[locale] : '');
const fieldErrors = $derived(
  (form?.details && typeof form.details === 'object' ? form.details : {}) as Record<string, string>,
);
const failedSection = $derived((form?.values as { section?: string } | undefined)?.section ?? null);
const sourceLabel = {
  tenant: t('settings.source_tenant'),
  global: t('settings.source_global'),
  default: t('settings.source_default'),
} as const;
const locales = [
  { value: 'id', label: t('lang.id') },
  { value: 'en', label: t('lang.en') },
];
</script>

<svelte:head><title>{t('nav.settings')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('nav.settings')}</h1>
    {#if data.canGlobal}
      <nav class="flex gap-1 rounded-md border p-1 text-sm" aria-label={t('settings.scope')}>
        <a href="?scope=tenant" class={`rounded px-3 py-1 no-underline ${data.scope === 'tenant' ? 'bg-accent text-accent-foreground' : ''}`}>{t('settings.scope_tenant')}</a>
        <a href="?scope=global" class={`rounded px-3 py-1 no-underline ${data.scope === 'global' ? 'bg-accent text-accent-foreground' : ''}`}>{t('settings.scope_global')}</a>
      </nav>
    {/if}
  </div>
  <p class="text-sm text-muted-foreground">
    {#if data.scope === 'global'}{t('settings.lead_global')}{:else}{t('settings.lead_tenant')}{/if}
    {t('settings.lead_instant')}
  </p>
  {#if form?.error && !failedSection}<p class="error">{form.error}</p>{/if}

  {#each data.sections as s (s.section)}
    <Card id={s.section} title={L(s.title)} description={L(s.note) || undefined}>
      {#snippet actions()}<Badge variant="outline">{s.module}</Badge>{/snippet}
      {#if data.saved === s.section}<p class="notice mb-4">{t('common.saved')}</p>{/if}
      {#if failedSection === s.section && form?.error}<p class="error mb-4">{form.error}</p>{/if}
      <form method="POST" action="?/save" class="grid gap-4 sm:grid-cols-2">
        <Csrf token={data.csrf} />
        <input type="hidden" name="_scope" value={data.scope} />
        <input type="hidden" name="_section" value={s.section} />
        {#each s.fields as f (f.key)}
          {@const id = `f-${f.key}`}
          {@const err = fieldErrors[f.key]}
          {@const strVal = f.value === null || f.value === undefined ? '' : String(f.value)}
          <input type="hidden" name="_keys" value={f.key} />
          {#if f.type === 'list'}<input type="hidden" name="_lists" value={f.key} />{/if}
          {#if f.type === 'boolean'}<input type="hidden" name="_bools" value={f.key} />{/if}
          {#if f.type === 'secret'}<input type="hidden" name="_secrets" value={f.key} />{/if}
          <Field label={L(f.title)} for={id} hint={`${L(f.note)}${L(f.note) ? ' · ' : ''}${t('settings.hint_source', { source: sourceLabel[f.source] })}${f.public ? ` · ${t('settings.hint_public')}` : ''}`} error={err} class={f.type === 'text' || f.type === 'markdown' || f.type === 'list' ? 'sm:col-span-2' : ''}>
            {#if f.type === 'boolean'}
              <div class="flex flex-wrap items-center gap-4 text-sm">
                <label class="flex items-center gap-2"><input type="radio" name={`${f.key}__tri`} value="set" checked={f.source !== 'default' || f.value !== null} class="accent-primary" /> {t('settings.bool_set')}</label>
                <label class="flex items-center gap-2"><Checkbox {id} name={f.key} checked={f.value === true} /> {t('common.active')}</label>
                <label class="flex items-center gap-2"><input type="radio" name={`${f.key}__tri`} value="inherit" checked={f.source === 'default' && f.value === null} class="accent-primary" /> {data.scope === 'global' ? t('settings.inherit_default') : t('settings.inherit_global')}</label>
              </div>
            {:else if f.type === 'secret'}
              <Input {id} type="password" name={f.key} placeholder={f.secretSet ? t('settings.secret_set_placeholder') : t('settings.secret_unset_placeholder')} autocomplete="off" />
              {#if f.secretSet}<label class="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox name={`${f.key}__clear`} /> {t('settings.secret_clear')}</label>{/if}
            {:else if f.type === 'select' || f.type === 'theme'}
              <Select {id} name={f.key} value={strVal}>
                <option value="">{data.scope === 'global' ? t('settings.option_default') : t('settings.option_inherit_global')}</option>
                {#each f.options ?? [] as o (o.value)}<option value={o.value} selected={strVal === o.value}>{L(o.label)}</option>{/each}
              </Select>
            {:else if f.type === 'route'}
              <Select {id} name={f.key} value={strVal}>
                <option value="">{data.scope === 'global' ? t('settings.option_default') : t('settings.option_inherit_global')}</option>
                {#each data.routes as r (r)}<option value={r} selected={strVal === r}>{r}</option>{/each}
              </Select>
            {:else if f.type === 'locale'}
              <Select {id} name={f.key} value={strVal}>
                <option value="">{data.scope === 'global' ? t('settings.option_default') : t('settings.option_inherit_global')}</option>
                {#each locales as o (o.value)}<option value={o.value} selected={strVal === o.value}>{o.label}</option>{/each}
              </Select>
            {:else if f.type === 'list'}
              <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
                {#each f.options ?? [] as o (o.value)}
                  <label class="flex items-center gap-2"><Checkbox name={f.key} value={o.value} checked={Array.isArray(f.value) && f.value.includes(o.value)} /> {L(o.label)}</label>
                {:else}<span class="text-muted-foreground">—</span>{/each}
              </div>
            {:else if f.type === 'text' || f.type === 'markdown'}
              <Textarea {id} name={f.key} rows={f.type === 'markdown' ? 6 : 3} value={strVal} maxlength={f.max ?? undefined} />
            {:else if f.type === 'number'}
              <Input {id} type="number" name={f.key} value={strVal} min={f.min ?? undefined} max={f.max ?? undefined} step="any" />
            {:else}
              <Input {id} name={f.key} value={strVal} maxlength={f.max ?? undefined} />
            {/if}
          </Field>
        {/each}
        <div class="sm:col-span-2"><Button type="submit"><Icon name="save" size={16} />{t('settings.save_section', { section: L(s.title) })}</Button></div>
      </form>
    </Card>
  {/each}
</div>
