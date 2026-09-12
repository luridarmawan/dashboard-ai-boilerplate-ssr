<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import type { PageData } from './$types';

/**
 * The permission guide (C-8). Three things an admin needs and currently has to infer from the
 * group editor: what the strings mean, how a grant is matched against what a page asks for, and
 * which resources actually exist here — the last one read from the live registry, so a module's
 * resources appear the moment it is installed.
 */
let { data }: { data: PageData } = $props();
const t = useT();
const locale = useLocale() === 'en' ? 'en' : 'id';
const check = $derived(data.check);
/** The matching rules, each shown against the same requirement so they can be compared. */
const rules = [
  { grant: 'user.edit', key: 'exact', ok: true },
  { grant: 'user.manage', key: 'manage', ok: true },
  { grant: 'user.*', key: 'resource_star', ok: true },
  { grant: '*.edit', key: 'action_star', ok: true },
  { grant: '*.*', key: 'all', ok: true },
  { grant: 'user.read', key: 'other', ok: false },
] as const;
/** Literal keys, not built strings: `t()` only takes registered message keys. */
const combine = ['union', 'tenant', 'superadmin', 'concrete', 'invalid'] as const;
</script>

<svelte:head><title>{t('permguide.title')}</title></svelte:head>

<div class="page">
  <div>
    <h1>{t('permguide.title')}</h1>
    <p class="mt-1 max-w-3xl text-muted-foreground">{t('permguide.lead')}</p>
  </div>

  <!-- anatomy: one string, taken apart -->
  <Card title={t('permguide.anatomy.title')} description={t('permguide.anatomy.hint')}>
    <div class="flex flex-wrap items-end gap-x-2 gap-y-3 font-mono text-lg">
      <span class="rounded-md bg-primary/10 px-2 py-1 text-primary">example.product</span>
      <span class="text-muted-foreground">.</span>
      <span class="rounded-md bg-warning/15 px-2 py-1 text-warning">edit</span>
    </div>
    <dl class="mt-4 grid gap-3 sm:grid-cols-2">
      <div><dt class="text-sm font-medium">{t('permguide.anatomy.resource')}</dt><dd class="text-sm text-muted-foreground">{t('permguide.anatomy.resource_text')}</dd></div>
      <div><dt class="text-sm font-medium">{t('permguide.anatomy.action')}</dt><dd class="text-sm text-muted-foreground">{t('permguide.anatomy.action_text')}</dd></div>
    </dl>
  </Card>

  <!-- the matching rules, all against one requirement -->
  <Card title={t('permguide.rules.title')} description={t('permguide.rules.lead')}>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-xs text-muted-foreground">
          <tr>
            <th class="py-1 text-start">{t('permguide.rules.col_grant')}</th>
            <th class="py-1 text-start">{t('permguide.rules.col_means')}</th>
            <th class="py-1 text-start">{t('permguide.rules.col_verdict')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rules as r (r.grant)}
            <tr class="border-t">
              <td class="py-2 pe-3"><code>{r.grant}</code></td>
              <td class="py-2 pe-3 text-muted-foreground">{t(`permguide.rule.${r.key}`)}</td>
              <td class="py-2">
                {#if r.ok}
                  <span class="inline-flex items-center gap-1 text-success"><Icon name="check" size={14} />{t('permguide.rules.allows')}</span>
                {:else}
                  <span class="inline-flex items-center gap-1 text-muted-foreground"><Icon name="x" size={14} />{t('permguide.rules.denies')}</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="mt-3 text-xs text-muted-foreground">{t('permguide.rules.footnote')}</p>
  </Card>

  <!-- how a person ends up with a permission at all -->
  <Card title={t('permguide.combine.title')}>
    <ul class="grid gap-2 text-sm">
      {#each combine as k (k)}
        <li class="flex gap-2"><Icon name="chevron-right" size={16} class="mt-0.5 shrink-0 text-muted-foreground rtl:rotate-180" /><span>{t(`permguide.combine.${k}`)}</span></li>
      {/each}
    </ul>
  </Card>

  <!-- checker: a GET form, so the answer is computed on the server and the URL is shareable -->
  <Card title={t('permguide.check.title')} description={t('permguide.check.lead')}>
    <form method="GET" class="flex flex-wrap items-end gap-3" data-testid="permcheck">
      <label class="grid gap-1 text-sm font-medium">
        {t('permguide.check.granted')}
        <input name="granted" value={check.granted} placeholder="user.*, group.read" class="h-9 w-72 rounded-md border border-input bg-background px-2 font-mono text-sm font-normal" />
        <span class="text-xs font-normal text-muted-foreground">{t('permguide.check.granted_hint')}</span>
      </label>
      <label class="grid gap-1 text-sm font-medium">
        {t('permguide.check.required')}
        <input name="required" value={check.required} list="permission-list" placeholder="user.edit" class="h-9 w-56 rounded-md border border-input bg-background px-2 font-mono text-sm font-normal" />
        <span class="text-xs font-normal text-muted-foreground">{t('permguide.check.required_hint')}</span>
      </label>
      <div class="mb-6"><Button type="submit">{t('permguide.check.submit')}</Button></div>
    </form>
    <datalist id="permission-list">{#each data.all as p (p)}<option value={p}></option>{/each}</datalist>

    {#if check.result}
      {#if !check.result.concrete}
        <p class="error mt-4" role="status" data-testid="permcheck-result">{t('permguide.check.not_concrete')}</p>
      {:else if check.result.allowed}
        <p class="notice mt-4" role="status" data-testid="permcheck-result">
          {t('permguide.check.allowed', { required: check.result.required })}
          <span class="block text-xs">{t('permguide.check.matched', { grants: check.result.matched.join(', ') })}</span>
        </p>
      {:else}
        <p class="error mt-4" role="status" data-testid="permcheck-result">{t('permguide.check.denied', { required: check.result.required })}</p>
      {/if}
    {/if}
  </Card>

  <!-- the registry of this installation, core + modules (C-4) -->
  <Card title={t('permguide.registry.title')} description={t('permguide.registry.lead')}>
    <div class="overflow-x-auto">
      <table class="w-full text-sm" data-testid="permission-registry">
        <thead class="text-xs text-muted-foreground">
          <tr>
            <th class="py-1 text-start">{t('permguide.registry.col_resource')}</th>
            <th class="py-1 text-start">{t('permguide.registry.col_code')}</th>
            <th class="py-1 text-start">{t('permguide.registry.col_actions')}</th>
            <th class="py-1 text-start">{t('permguide.registry.col_module')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.resources as r (r.resource)}
            <tr class="border-t align-top">
              <td class="py-2 pe-3 font-medium">{locale === 'en' ? r.name.en : r.name.id}</td>
              <td class="py-2 pe-3"><code>{r.resource}</code></td>
              <td class="py-2 pe-3">
                <span class="flex flex-wrap gap-1">
                  {#each r.actions as a (a)}<code class="rounded-sm bg-muted px-1 py-0.5 text-xs">{r.resource}.{a}</code>{/each}
                </span>
              </td>
              <td class="py-2"><Badge variant={r.module === 'core' ? 'secondary' : 'outline'}>{r.module}</Badge></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Card>
</div>
