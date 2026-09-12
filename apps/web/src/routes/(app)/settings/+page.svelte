<script lang="ts">
import { onMount } from 'svelte';
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card, Checkbox, Field, Input, Select, Textarea } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { hasPermission } from '$lib/permissions';
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

/**
 * Section actions (extension point 6): a module declares a button, this page runs it over fetch
 * and shows the verdict in place. Nothing here knows what any particular action does — the
 * result is always one message plus optional detail lines, and an action that needs one value
 * from the operator (where to send a test e-mail) declares that input in the same metadata.
 */
type ActionResult = { ok: boolean; message: string; details?: string[] };
let running = $state<string | null>(null);
let results = $state<Record<string, ActionResult>>({});
const can = (p: string | null) =>
  !p || data.user.isSuperadmin || hasPermission(data.permissions, p);

/**
 * Per action, what its input currently holds — seeded once from the prefill the API resolved for
 * THIS scope, then left alone so typing survives a re-render. The scope is part of the key: the
 * global and the tenant form are two different configurations, so they prefill differently.
 */
let inputs = $state<Record<string, string>>({});
const inputId = (section: string, key: string) => `${data.scope}:${section}:${key}`;
$effect(() => {
  const next = { ...inputs };
  let seeded = false;
  for (const s of data.sections) {
    for (const a of s.actions) {
      const id = inputId(s.section, a.key);
      if (a.input && next[id] === undefined) {
        next[id] = a.input.default ?? '';
        seeded = true;
      }
    }
  }
  if (seeded) inputs = next;
});

async function runAction(section: string, key: string, inputKey?: string | null) {
  const id = `${section}:${key}`;
  running = id;
  try {
    const body = new FormData();
    body.set('_csrf', data.csrf);
    body.set('section', section);
    body.set('action', key);
    body.set('scope', data.scope);
    if (inputKey) body.set(`input.${inputKey}`, inputs[inputId(section, key)] ?? '');
    const res = await fetch('/settings/action', { method: 'POST', body });
    results = { ...results, [id]: (await res.json()) as ActionResult };
  } catch (err) {
    results = {
      ...results,
      [id]: { ok: false, message: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    running = null;
  }
}

/**
 * Tab ordering specification:
 * 1. Application (section 'app')
 * 2. Modules (non-core sections: e.g. AI, Dummy module, Example landing, etc.)
 * 3. Security (section 'security')
 * 4. Logs & retention (section 'logs')
 * 5. Uploaded files (section 'files')
 * 6. Email (section 'mail')
 * 7. Any other fallback section
 */
const CORE_ORDER: Record<string, number> = {
  app: 1,
  security: 3,
  logs: 4,
  files: 5,
  mail: 6,
};

function getSectionSortOrder(s: { section: string; module: string; order?: number }) {
  if (s.section === 'app') return { group: 1, order: s.order ?? 0 };
  if (s.section === 'security') return { group: 3, order: s.order ?? 0 };
  if (s.section === 'logs') return { group: 4, order: s.order ?? 0 };
  if (s.section === 'files') return { group: 5, order: s.order ?? 0 };
  if (s.section === 'mail') return { group: 6, order: s.order ?? 0 };
  if (s.module !== 'core' || !CORE_ORDER[s.section]) {
    return { group: 2, order: s.order ?? 100 };
  }
  return { group: 7, order: s.order ?? 999 };
}

const sortedSections = $derived(
  [...data.sections].sort((a, b) => {
    const orderA = getSectionSortOrder(a);
    const orderB = getSectionSortOrder(b);
    if (orderA.group !== orderB.group) {
      return orderA.group - orderB.group;
    }
    return orderA.order - orderB.order;
  }),
);

let activeSection = $state<string>('');

// Initialize active tab from URL searchParam (tab/saved), URL hash, or first tab
$effect(() => {
  if (!activeSection && sortedSections.length > 0) {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
    const urlParams =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const tabParam = urlParams?.get('tab');
    const initial = data.saved || tabParam || hash;
    if (initial && sortedSections.some((s) => s.section === initial)) {
      activeSection = initial;
    } else {
      activeSection = sortedSections[0]?.section ?? '';
    }
  }
});

onMount(() => {
  const onHashChange = () => {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash && sortedSections.some((s) => s.section === hash)) {
      activeSection = hash;
    }
  };
  window.addEventListener('hashchange', onHashChange);
  return () => window.removeEventListener('hashchange', onHashChange);
});

function selectTab(section: string) {
  activeSection = section;
}

// Track AJAX save status per section
let saving = $state<string | null>(null);
let savedNotice = $state<string | null>(null);
let clientError = $state<{ section: string; message: string } | null>(null);

let savedTimer: ReturnType<typeof setTimeout> | null = null;
function triggerSavedNotice(section: string) {
  savedNotice = section;
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    if (savedNotice === section) savedNotice = null;
  }, 4000);
}

$effect(() => {
  if (data.saved) {
    triggerSavedNotice(data.saved);
  }
});
</script>

<svelte:head><title>{t('nav.settings')}</title></svelte:head>

<div class="page">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1>{t('nav.settings')}</h1>
    {#if data.canGlobal}
      <!--
        Which scope is open decides what a save WRITES — the tenant's own value or the global
        default every tenant inherits — so the switch cannot read as two equal tabs. The open one
        is filled with the primary colour and carries `aria-current`; the other is muted.
      -->
      <nav class="flex gap-1 rounded-md border p-1 text-sm" aria-label={t('settings.scope')}>
        {#each [{ scope: 'tenant', label: t('settings.scope_tenant') }, { scope: 'global', label: t('settings.scope_global') }] as s (s.scope)}
          <a
            href={`?scope=${s.scope}`}
            aria-current={data.scope === s.scope ? 'page' : undefined}
            class={`rounded px-3 py-1 no-underline ${data.scope === s.scope ? 'bg-primary font-medium text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
          >{s.label}</a>
        {/each}
      </nav>
    {/if}
  </div>
  <p class="text-sm text-muted-foreground">
    {#if data.scope === 'global'}{t('settings.lead_global')}{:else}{t('settings.lead_tenant')}{/if}
    {t('settings.lead_instant')}
  </p>
  {#if form?.error && !failedSection}<p class="error">{form.error}</p>{/if}

  <!-- Tab navigation -->
  <div class="border-b border-border">
    <div class="-mb-px flex flex-wrap gap-1 text-sm font-medium" role="tablist" aria-label={t('nav.settings')}>
      {#each sortedSections as s (s.section)}
        {@const isActive = (activeSection || sortedSections[0]?.section) === s.section}
        <button
          type="button"
          role="tab"
          id={`tab-${s.section}`}
          data-tab={s.section}
          aria-selected={isActive}
          aria-controls={s.section}
          tabindex={isActive ? 0 : -1}
          onclick={() => selectTab(s.section)}
          class={`group inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
            isActive
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
          }`}
        >
          <span>{L(s.title)}</span>
          {#if s.module !== 'core'}
            <!-- module name at label
            <Badge variant="outline" class="text-[10px] px-1.5 py-0 uppercase tracking-wider">{s.module}</Badge>
            -->
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- Tab panels -->
  {#each sortedSections as s (s.section)}
    {@const isCurrent = (activeSection || sortedSections[0]?.section) === s.section}
    <div
      role="tabpanel"
      id={s.section}
      aria-labelledby={`tab-${s.section}`}
      class={isCurrent ? 'block' : 'hidden'}
    >
      <Card title={L(s.title)} description={L(s.note) || undefined}>
        {#snippet actions()}<Badge variant="outline">{s.module}</Badge>{/snippet}
        {#if savedNotice === s.section}<p class="notice mb-4" role="status">{t('common.saved')}</p>{/if}
        {#if (failedSection === s.section && form?.error) || (clientError?.section === s.section && clientError.message)}
          <p class="error mb-4" role="alert">{clientError?.section === s.section ? clientError.message : form?.error}</p>
        {/if}
        <form
          method="POST"
          action="?/save"
          class="grid gap-4 sm:grid-cols-2"
          use:enhance={() => {
            saving = s.section;
            clientError = null;
            return async ({ result, update }) => {
              saving = null;
              if (result.type === 'redirect') {
                triggerSavedNotice(s.section);
                await invalidateAll();
              } else if (result.type === 'failure') {
                const failureData = result.data as { message?: string; error?: string } | undefined;
                clientError = {
                  section: s.section,
                  message: failureData?.message || failureData?.error || t('settings.error_load'),
                };
                await update();
              } else {
                await update();
              }
            };
          }}
        >
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
          <div class="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={saving === s.section}>
              <Icon name={saving === s.section ? 'refresh' : 'save'} size={16} class={saving === s.section ? 'animate-spin' : ''} />
              {saving === s.section ? t('common.running') : t('settings.save_section', { section: L(s.title) })}
            </Button>
            {#each s.actions.filter((a) => can(a.permission)) as a (a.key)}
              {@const id = `${s.section}:${a.key}`}
              {#if a.input}
                <!-- The one value the action asks for; it travels under the field name the API declared. -->
                <label class="flex min-w-0 items-center gap-2 text-sm" for={`action-${id}`}>
                  <span class="text-muted-foreground">{L(a.input.label)}</span>
                  <Input
                    id={`action-${id}`}
                    type={a.input.type === 'email' ? 'email' : 'text'}
                    class="w-64 max-w-full"
                    maxlength={a.input.max ?? undefined}
                    placeholder={L(a.input.placeholder) || undefined}
                    bind:value={inputs[inputId(s.section, a.key)]}
                    onkeydown={(e) => {
                      // Enter here means "run the action", not "save the section" — the input sits
                      // inside the save form but belongs to the button next to it.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        runAction(s.section, a.key, a.input?.key);
                      }
                    }}
                  />
                </label>
              {/if}
              <Button type="button" variant="outline" disabled={running === id} title={L(a.note) || undefined} onclick={() => runAction(s.section, a.key, a.input?.key)}>
                <Icon name="refresh" size={16} />{running === id ? t('common.running') : L(a.label)}
              </Button>
            {/each}
          </div>
          {#each s.actions as a (a.key)}
            {@const r = results[`${s.section}:${a.key}`]}
            {#if r}
              <div class="sm:col-span-2" data-testid={`action-result-${s.section}-${a.key}`}>
                <p class={r.ok ? 'notice' : 'error'} role={r.ok ? undefined : 'alert'}>{r.message}</p>
                {#if r.details?.length}
                  <ul class="mt-1 text-xs text-muted-foreground">
                    {#each r.details as d, i (i)}<li>{d}</li>{/each}
                  </ul>
                {/if}
              </div>
            {/if}
          {/each}
        </form>
      </Card>
    </div>
  {/each}
</div>
