<script lang="ts">
import {
  COLOR_TOKENS,
  CONTRAST_PAIRS,
  contrastRatio,
  isHexColor,
  SHAPE_TOKENS,
  tokensToInlineStyle,
} from '@core/ui-theme';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Badge, Button, Card } from '$lib/components/ui';
import { useLocale, useT } from '$lib/i18n';
import { type EditorValues, KINDS, VARIANTS } from './_editor.ts';

/**
 * The theme editor (PRD L-24). Left: the form, grouped by what a designer thinks about (identity,
 * layouts, shape, colours). Right, sticky: a LIVE preview — real components rendered with the
 * candidate tokens as inline CSS variables (so the preview cannot drift from the app), in light and
 * dark, plus the WCAG AA report for every checked pair. Everything renders on the server from the
 * submitted values; with JavaScript the preview and the report follow each keystroke.
 */
let {
  values,
  vocab,
  csrf,
  action,
  isNew,
  errors = {},
  contrast = [],
  previews,
  notice = null,
  error = null,
  readonly = false,
}: {
  values: EditorValues;
  vocab: {
    iconSets: { id: string; name: { id: string; en: string } }[];
    layouts: { id: string; kind: string; name: { id: string; en: string } }[];
    bases: { id: string; name: { id: string; en: string } }[];
  };
  csrf: string;
  action: string;
  isNew: boolean;
  errors?: Record<string, string>;
  contrast?: { mode: string; fg: string; bg: string; message: string }[];
  previews: { light: string; dark: string };
  notice?: string | null;
  error?: string | null;
  readonly?: boolean;
} = $props();

const t = useT();
const locale = useLocale() === 'en' ? 'en' : 'id';
// Live state (progressive enhancement): seeded from the server values, updated on input.
// svelte-ignore state_referenced_locally -- the $effect below re-seeds when the server values change
let light = $state<Record<string, string>>({ ...values.tokens.light });
// svelte-ignore state_referenced_locally -- same
let dark = $state<Record<string, string>>({ ...values.tokens.dark });
$effect(() => {
  light = { ...values.tokens.light };
  dark = { ...values.tokens.dark };
});
const darkMerged = $derived({ ...light, ...dark });
const lightStyle = $derived(tokensToInlineStyle(light));
const darkStyle = $derived(tokensToInlineStyle(darkMerged));
const report = $derived(
  (['light', 'dark'] as const).flatMap((mode) =>
    CONTRAST_PAIRS.map(([fg, bg, minimum]) => {
      const map = mode === 'light' ? light : darkMerged;
      const ratio =
        isHexColor(map[fg]) && isHexColor(map[bg])
          ? contrastRatio(map[fg] as string, map[bg] as string)
          : null;
      return { mode, fg, bg, minimum, ratio, ok: ratio !== null && ratio >= minimum };
    }),
  ),
);
const failing = $derived(report.filter((r) => !r.ok).length);
const serverFailing = $derived(new Set(contrast.map((c) => `${c.mode}:${c.fg}:${c.bg}`)));

const input =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60';
const label = 'grid gap-1 text-sm';
const layoutsOf = (kind: string) => vocab.layouts.filter((l) => l.kind === kind);
const hex = (v: string | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000');
const groups: [string, string, readonly string[]][] = [
  [
    t('themes.editor.group.surface'),
    t('themes.editor.group.surface_desc'),
    ['background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground'],
  ],
  [
    t('themes.editor.group.action'),
    t('themes.editor.group.action_desc'),
    [
      'primary',
      'primary-foreground',
      'secondary',
      'secondary-foreground',
      'accent',
      'accent-foreground',
    ],
  ],
  [
    t('themes.editor.group.muted'),
    t('themes.editor.group.muted_desc'),
    ['muted', 'muted-foreground'],
  ],
  [
    t('themes.editor.group.status'),
    t('themes.editor.group.status_desc'),
    [
      'destructive',
      'destructive-foreground',
      'success',
      'success-foreground',
      'warning',
      'warning-foreground',
    ],
  ],
  [
    t('themes.editor.group.lines'),
    t('themes.editor.group.lines_desc'),
    ['border', 'input', 'ring'],
  ],
  [
    t('themes.editor.group.chart'),
    t('themes.editor.group.chart_desc'),
    COLOR_TOKENS.filter((n) => n.startsWith('chart-')),
  ],
];
const kindLabel: Record<string, string> = {
  dashboard: t('themes.editor.kind.dashboard'),
  public: t('themes.editor.kind.public'),
  auth: t('themes.editor.kind.auth'),
};
</script>

<form method="POST" {action} enctype="multipart/form-data" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
  <Csrf token={csrf} />
  <div class="grid gap-4">
    {#if notice}<p class="notice">{notice}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <Card title={t('themes.editor.identity')} description={t('themes.editor.identity_desc')}>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class={label}>{t('themes.editor.name_id')} <input name="nameId" value={values.nameId} required maxlength="120" class={input} disabled={readonly} />{#if errors.name}<span class="text-xs text-destructive">{errors.name}</span>{/if}</label>
        <label class={label}>{t('themes.editor.name_en')} <input name="nameEn" value={values.nameEn} required maxlength="120" class={input} disabled={readonly} /></label>
        <label class={label}>{t('themes.editor.description_id')} <input name="descriptionId" value={values.descriptionId} maxlength="300" class={input} disabled={readonly} /></label>
        <label class={label}>{t('themes.editor.description_en')} <input name="descriptionEn" value={values.descriptionEn} maxlength="300" class={input} disabled={readonly} /></label>
        <label class={label}>{t('themes.editor.slug')}
          <div class="flex items-center gap-2"><span class="text-sm text-muted-foreground">custom.</span><input name="slug" value={values.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="40" class={input} disabled={readonly} placeholder="biru-perusahaan" /></div>
          {#if errors.slug}<span class="text-xs text-destructive">{errors.slug}</span>{/if}
        </label>
        <label class={label}>{t('themes.editor.base')}
          {#if isNew}
            <select name="base" class={input} disabled={readonly}>{#each vocab.bases as b (b.id)}<option value={b.id} selected={b.id === values.base}>{b.name[locale]} ({b.id})</option>{/each}</select>
          {:else}
            <input name="base" value={values.base} readonly class={input} />
          {/if}
        </label>
        <label class={label}>{t('themes.editor.icon_set')}
          <select name="icons" class={input} disabled={readonly}>{#each vocab.iconSets as s (s.id)}<option value={s.id} selected={s.id === values.icons}>{s.name[locale]} ({s.id})</option>{/each}</select>
          {#if errors.icons}<span class="text-xs text-destructive">{errors.icons}</span>{/if}
        </label>
        <label class="flex items-center gap-2 self-end rounded-md border px-3 py-2 text-sm"><input type="checkbox" name="enabled" checked={values.enabled} class="accent-primary" disabled={readonly} /> {t('themes.editor.enabled')}</label>
        <div class="grid gap-2 rounded-md border p-3 text-sm sm:col-span-2" data-testid="theme-logo">
          <div class="flex flex-wrap items-center gap-3">
            {#if values.logoUrl}
              <img src={values.logoUrl} alt={t('themes.editor.logo_alt')} class="h-10 w-auto max-w-40 rounded bg-background object-contain p-1" />
            {:else}
              <span class="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground"><Icon name="image" size={18} /></span>
            {/if}
            <label class="grid flex-1 gap-1">
              <span class="font-medium">{t('themes.editor.logo')}</span>
              <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" class="text-sm" disabled={readonly} />
              <span class="text-xs text-muted-foreground">{t('themes.editor.logo_hint')}</span>
            </label>
            <input type="hidden" name="logoId" value={values.logoId} />
            {#if values.logoId}<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="removeLogo" class="accent-primary" disabled={readonly} /> {t('themes.editor.remove_logo')}</label>{/if}
          </div>
          {#if errors.logo}<span class="text-xs text-destructive">{errors.logo}</span>{/if}
        </div>
        <div class="grid gap-2 rounded-md border p-3 text-sm sm:col-span-2" data-testid="theme-favicon">
          <div class="flex flex-wrap items-center gap-3">
            {#if values.faviconUrl}
              <img src={values.faviconUrl} alt={t('themes.editor.favicon_alt')} class="h-8 w-8 rounded bg-background object-contain p-0.5" />
            {:else}
              <span class="flex h-8 w-8 items-center justify-center rounded bg-muted text-muted-foreground"><Icon name="star" size={14} /></span>
            {/if}
            <label class="grid flex-1 gap-1">
              <span class="font-medium">{t('themes.editor.favicon')}</span>
              <input type="file" name="favicon" accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon" class="text-sm" disabled={readonly} />
              <span class="text-xs text-muted-foreground">{t('themes.editor.favicon_hint')}</span>
            </label>
            <input type="hidden" name="faviconId" value={values.faviconId} />
            {#if values.faviconId}<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="removeFavicon" class="accent-primary" disabled={readonly} /> {t('themes.editor.remove_favicon')}</label>{/if}
          </div>
          {#if errors.favicon}<span class="text-xs text-destructive">{errors.favicon}</span>{/if}
        </div>
      </div>
    </Card>

    <Card title={t('themes.editor.layouts')} description={t('themes.editor.layouts_desc')}>
      <div class="grid gap-3 md:grid-cols-3">
        {#each KINDS as kind (kind)}
          <fieldset class="grid gap-2">
            <legend class="px-1 text-sm font-medium">{kindLabel[kind] ?? kind}</legend>
            {#each VARIANTS[kind] as variant (variant)}
              <label class={label}><span class="flex items-center gap-1"><code>{variant}</code>{#if variant === 'default'}<span class="text-xs text-muted-foreground">{t('themes.editor.required')}</span>{/if}</span>
                <select name={`layout__${kind}__${variant}`} class={input} disabled={readonly}>
                  {#if variant !== 'default'}<option value="" selected={!values.layouts[kind]?.[variant]}>{t('themes.editor.follow_default')}</option>{/if}
                  {#each layoutsOf(kind) as l (l.id)}<option value={l.id} selected={values.layouts[kind]?.[variant] === l.id}>{l.name[locale]}</option>{/each}
                </select>
              </label>
            {/each}
            {#if errors[`layouts.${kind}`]}<span class="text-xs text-destructive">{errors[`layouts.${kind}`]}</span>{/if}
          </fieldset>
        {/each}
      </div>
    </Card>

    <Card title={t('themes.editor.shape')} description={t('themes.editor.shape_desc')}>
      <div class="grid gap-3 sm:grid-cols-3">
        {#each SHAPE_TOKENS as name (name)}
          <label class={label}><code>--{name}</code><input name={`tl__${name}`} value={light[name] ?? ''} maxlength="200" class={input} disabled={readonly} oninput={(e) => { light = { ...light, [name]: (e.currentTarget as HTMLInputElement).value }; }} />{#if errors[`tokens.light.${name}`]}<span class="text-xs text-destructive">{errors[`tokens.light.${name}`]}</span>{/if}</label>
        {/each}
      </div>
    </Card>

    {#each groups as [title, description, names] (title)}
      <Card {title} {description}>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each names as name (name)}
            {@const lightBad = errors[`tokens.light.${name}`]}
            {@const darkBad = errors[`tokens.dark.${name}`]}
            <div class="grid gap-2 rounded-md border p-2.5 text-sm" data-token={name}>
              <div class="flex items-center justify-between gap-2">
                <code class="truncate">--{name}</code>
                {#if report.some((r) => !r.ok && (r.fg === name || r.bg === name))}<Badge variant="destructive">{t('themes.editor.contrast_badge')}</Badge>{/if}
              </div>
              <div class="grid grid-cols-2 gap-2">
                <label class="flex items-center gap-2 rounded-md border bg-background px-2 py-1" title={t('themes.editor.light_mode')}>
                  <input type="color" name={`tl__${name}`} value={hex(light[name])} class="h-7 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" disabled={readonly} oninput={(e) => { light = { ...light, [name]: (e.currentTarget as HTMLInputElement).value }; }} />
                  <span class="grid leading-tight"><span class="text-[10px] uppercase tracking-wide text-muted-foreground">{t('themes.editor.light')}</span><span class="font-mono text-xs">{light[name] ?? '—'}</span></span>
                </label>
                <label class="flex items-center gap-2 rounded-md border bg-background px-2 py-1" title={t('themes.editor.dark_mode')}>
                  <input type="color" name={`td__${name}`} value={hex(dark[name] ?? light[name])} class="h-7 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" disabled={readonly} oninput={(e) => { dark = { ...dark, [name]: (e.currentTarget as HTMLInputElement).value }; }} />
                  <span class="grid leading-tight"><span class="text-[10px] uppercase tracking-wide text-muted-foreground">{t('themes.editor.dark')}</span><span class="font-mono text-xs">{dark[name] ?? light[name] ?? '—'}</span></span>
                </label>
              </div>
              {#if lightBad || darkBad}<span class="text-xs text-destructive">{lightBad ?? darkBad}</span>{/if}
            </div>
          {/each}
        </div>
      </Card>
    {/each}

    {#if !readonly}
      <div class="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg"><Icon name="save" size={16} />{isNew ? t('themes.editor.create') : t('themes.editor.save')}</Button>
        <Button href="/themes" variant="outline" size="lg">{t('common.back')}</Button>
        <span class="text-sm text-muted-foreground">{t('themes.editor.save_hint')}</span>
      </div>
    {/if}
  </div>

  <!-- Sticky preview column: real components under the candidate tokens, light and dark. -->
  <aside class="grid gap-4 lg:sticky lg:top-20">
    <Card title={t('themes.editor.preview')} description={t('themes.editor.preview_desc')}>
      <div class="grid gap-3">
        {#each [['light', t('themes.editor.light_title'), lightStyle], ['dark', t('themes.editor.dark_title'), darkStyle]] as [mode, name, style] (mode)}
          <div class="overflow-hidden rounded-lg border" data-mode={mode} data-testid={`live-preview-${mode}`}>
            <div class="bg-background p-3 text-foreground" {style}>
              <div class="mb-2 flex items-center justify-between text-xs">
                <span class="font-medium">{name}</span>
                <span class="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-primary-foreground"><Icon name="sparkles" size={12} />{values.nameId || t('theme.theme')}</span>
              </div>
              <div class="rounded-md border bg-card p-3 text-card-foreground shadow-xs">
                <p class="text-sm font-semibold">{t('themes.editor.sample.card_title')}</p>
                <p class="text-xs text-muted-foreground">{t('themes.editor.sample.card_text')}</p>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <span class="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground">{t('themes.editor.sample.primary')}</span>
                  <span class="inline-flex h-7 items-center rounded-md bg-secondary px-2.5 text-xs font-medium text-secondary-foreground">{t('themes.editor.sample.secondary')}</span>
                  <span class="inline-flex h-7 items-center rounded-md border border-input bg-background px-2.5 text-xs font-medium">Outline</span>
                  <span class="inline-flex h-7 items-center rounded-md bg-destructive px-2.5 text-xs font-medium text-destructive-foreground">{t('themes.editor.sample.delete')}</span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <span class="rounded-md bg-success px-2 py-0.5 text-xs text-success-foreground">{t('themes.editor.sample.success')}</span>
                  <span class="rounded-md bg-warning px-2 py-0.5 text-xs text-warning-foreground">{t('themes.editor.sample.warning')}</span>
                  <span class="rounded-md bg-accent px-2 py-0.5 text-xs text-accent-foreground">{t('themes.editor.sample.accent')}</span>
                </div>
                <div class="mt-2 h-8 rounded-md border border-input bg-background px-2 text-xs leading-8 text-muted-foreground ring-2 ring-ring/40">{t('themes.editor.sample.input')}</div>
                <div class="mt-2 flex h-8 items-end gap-1">
                  {#each ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as c, i (c)}<span class="w-4 rounded-t-sm" style={`height:${40 + i * 12}%;background:var(--${c})`}></span>{/each}
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </Card>
    <Card title={t('themes.editor.contrast')} description={t('themes.editor.contrast_desc')}>
      <div class="mb-2 flex items-center gap-2 text-sm">
        {#if failing}<Badge variant="destructive">{t('themes.editor.pairs_failing', { n: failing })}</Badge>{:else}<Badge variant="success">{t('themes.editor.all_pass')}</Badge>{/if}
        {#if contrast.length && failing === 0}<span class="text-xs text-muted-foreground">{t('themes.editor.server_result', { n: contrast.length })}</span>{/if}
      </div>
      <div class="max-h-72 overflow-auto rounded-md border">
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-muted text-muted-foreground"><tr><th class="px-2 py-1 text-start">{t('themes.editor.pair')}</th><th class="px-2 py-1 text-end">{t('themes.editor.light_title')}</th><th class="px-2 py-1 text-end">{t('themes.editor.dark_title')}</th></tr></thead>
          <tbody>
            {#each CONTRAST_PAIRS as [fg, bg, minimum] (fg + bg)}
              {@const l = report.find((r) => r.mode === 'light' && r.fg === fg && r.bg === bg)}
              {@const d = report.find((r) => r.mode === 'dark' && r.fg === fg && r.bg === bg)}
              <tr class="border-t">
                <td class="px-2 py-1"><code>{fg}</code> / <code>{bg}</code> <span class="text-muted-foreground">≥ {minimum}</span></td>
                {#each [l, d] as r, i (i)}
                  <td class={`px-2 py-1 text-end font-mono ${r?.ok ? 'text-success' : 'text-destructive'} ${serverFailing.has(`${r?.mode}:${fg}:${bg}`) ? 'font-semibold' : ''}`}>{r?.ratio === null || r?.ratio === undefined ? '—' : r.ratio.toFixed(2)}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if contrast.length}
        <ul class="mt-2 list-disc ps-5 text-xs text-destructive" data-testid="contrast-problems">{#each contrast as c, i (i)}<li>{c.message}</li>{/each}</ul>
      {/if}
    </Card>
    <Card title={t('themes.editor.dashboard_preview')} description={t('themes.editor.dashboard_preview_desc')}>
      <div class="flex flex-wrap gap-3">
        <figure class="grid gap-1"><div class="overflow-hidden rounded-md border">{@html previews.light}</div><figcaption class="text-xs text-muted-foreground">{t('themes.editor.light')}</figcaption></figure>
        <figure class="grid gap-1"><div class="overflow-hidden rounded-md border">{@html previews.dark}</div><figcaption class="text-xs text-muted-foreground">{t('themes.editor.dark')}</figcaption></figure>
      </div>
    </Card>
  </aside>
</form>
