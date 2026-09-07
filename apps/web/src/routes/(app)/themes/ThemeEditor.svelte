<script lang="ts">
import { COLOR_TOKENS, SHAPE_TOKENS } from '@core/ui-theme';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button, Card } from '$lib/components/ui';
import { type EditorValues, KINDS, VARIANTS } from './_editor.ts';

/**
 * The theme editor form (PRD L-24): assemble a theme from token values, a registered icon set and
 * registered layouts. Works without JavaScript — every control is a native input, the previews and
 * the contrast report come from the server after each submit.
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
  contrast?: {
    mode: string;
    fg: string;
    bg: string;
    ratio: number | null;
    minimum: number;
    message: string;
  }[];
  previews: { light: string; dark: string };
  notice?: string | null;
  error?: string | null;
  readonly?: boolean;
} = $props();

const input =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60';
const label = 'grid gap-1 text-sm';
const layoutsOf = (kind: string) => vocab.layouts.filter((l) => l.kind === kind);
const hex = (v: string | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000');
const groups: [string, readonly string[]][] = [
  [
    'Permukaan',
    ['background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground'],
  ],
  [
    'Aksi',
    [
      'primary',
      'primary-foreground',
      'secondary',
      'secondary-foreground',
      'accent',
      'accent-foreground',
    ],
  ],
  ['Peredam', ['muted', 'muted-foreground']],
  [
    'Status',
    [
      'destructive',
      'destructive-foreground',
      'success',
      'success-foreground',
      'warning',
      'warning-foreground',
    ],
  ],
  ['Garis & fokus', ['border', 'input', 'ring']],
  ['Bagan', COLOR_TOKENS.filter((n) => n.startsWith('chart-'))],
];
</script>

<form method="POST" {action} class="grid gap-4">
  <Csrf token={csrf} />
  {#if notice}<p class="notice">{notice}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <Card title="Identitas">
    <div class="grid gap-3 sm:grid-cols-2">
      <label class={label}>Nama (id) <input name="nameId" value={values.nameId} required maxlength="120" class={input} disabled={readonly} />{#if errors.name}<span class="text-xs text-destructive">{errors.name}</span>{/if}</label>
      <label class={label}>Name (en) <input name="nameEn" value={values.nameEn} required maxlength="120" class={input} disabled={readonly} /></label>
      <label class={label}>Deskripsi (id) <input name="descriptionId" value={values.descriptionId} maxlength="300" class={input} disabled={readonly} /></label>
      <label class={label}>Description (en) <input name="descriptionEn" value={values.descriptionEn} maxlength="300" class={input} disabled={readonly} /></label>
      <label class={label}>Slug <input name="slug" value={values.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="40" class={input} disabled={readonly} placeholder="mis. biru-perusahaan" /><span class="text-xs text-muted-foreground">Id tema: <code>custom.{values.slug || '…'}</code></span>{#if errors.slug}<span class="text-xs text-destructive">{errors.slug}</span>{/if}</label>
      <label class={label}>Turunan dari
        {#if isNew}
          <select name="base" class={input} disabled={readonly}>{#each vocab.bases as b (b.id)}<option value={b.id} selected={b.id === values.base}>{b.name.id} ({b.id})</option>{/each}</select>
          <span class="text-xs text-muted-foreground">Ganti lewat tautan di atas untuk memuat ulang token dari tema lain.</span>
        {:else}
          <input name="base" value={values.base} readonly class={input} />
        {/if}
      </label>
      <label class={label}>Set ikon
        <select name="icons" class={input} disabled={readonly}>{#each vocab.iconSets as s (s.id)}<option value={s.id} selected={s.id === values.icons}>{s.name.id} ({s.id})</option>{/each}</select>
        {#if errors.icons}<span class="text-xs text-destructive">{errors.icons}</span>{/if}
      </label>
      <label class="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="enabled" checked={values.enabled} class="accent-primary" disabled={readonly} /> Aktif — bisa dipilih pengguna dan dijadikan baku</label>
    </div>
  </Card>

  <Card title="Layout per jenis shell" description="Hanya layout yang sudah terdaftar (core atau modul) yang bisa dipilih; editor merakit, bukan membuat kode (L-8).">
    <div class="grid gap-4 md:grid-cols-3">
      {#each KINDS as kind (kind)}
        <fieldset class="grid gap-2 rounded-md border p-3">
          <legend class="px-1 text-sm font-medium">{kind}</legend>
          {#each VARIANTS[kind] as variant (variant)}
            <label class={label}>{variant}{variant === 'default' ? ' (wajib)' : ''}
              <select name={`layout__${kind}__${variant}`} class={input} disabled={readonly}>
                {#if variant !== 'default'}<option value="" selected={!values.layouts[kind]?.[variant]}>— ikuti default —</option>{/if}
                {#each layoutsOf(kind) as l (l.id)}<option value={l.id} selected={values.layouts[kind]?.[variant] === l.id}>{l.name.id} ({l.id})</option>{/each}
              </select>
            </label>
          {/each}
          {#if errors[`layouts.${kind}`]}<span class="text-xs text-destructive">{errors[`layouts.${kind}`]}</span>{/if}
        </fieldset>
      {/each}
    </div>
  </Card>

  <Card title="Pratinjau" description="Dihitung di server dari nilai yang tersimpan/terkirim — bukan dari CSS terpasang.">
    <div class="flex flex-wrap gap-4">
      <figure class="grid gap-1"><div class="overflow-hidden rounded-md border">{@html previews.light}</div><figcaption class="text-xs text-muted-foreground">terang</figcaption></figure>
      <figure class="grid gap-1"><div class="overflow-hidden rounded-md border">{@html previews.dark}</div><figcaption class="text-xs text-muted-foreground">gelap</figcaption></figure>
    </div>
    {#if contrast.length}
      <div class="error mt-3" role="alert" data-testid="contrast-problems">
        <p class="font-medium">Kontras WCAG AA belum terpenuhi (L-21) — {contrast.length} pasangan:</p>
        <ul class="mt-1 list-disc pl-5 text-sm">{#each contrast as c, i (i)}<li>{c.message}</li>{/each}</ul>
      </div>
    {/if}
  </Card>

  <Card title="Bentuk & huruf">
    <div class="grid gap-3 sm:grid-cols-3">
      {#each SHAPE_TOKENS as name (name)}
        <label class={label}><code>--{name}</code><input name={`tl__${name}`} value={values.tokens.light[name] ?? ''} maxlength="200" class={input} disabled={readonly} />{#if errors[`tokens.light.${name}`]}<span class="text-xs text-destructive">{errors[`tokens.light.${name}`]}</span>{/if}</label>
      {/each}
    </div>
  </Card>

  <Card title="Warna" description="Kolom kiri mode terang, kanan mode gelap. Warna gelap yang dikosongkan mewarisi nilai terang.">
    <div class="grid gap-6">
      {#each groups as [title, names] (title)}
        <div>
          <h3 class="mb-2 text-sm font-semibold">{title}</h3>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {#each names as name (name)}
              <div class="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border p-2 text-sm">
                <code class="truncate">--{name}</code>
                <label class="flex items-center gap-1" title="terang"><Icon name="sun" size={14} /><input type="color" name={`tl__${name}`} value={hex(values.tokens.light[name])} class="h-8 w-10 cursor-pointer rounded border bg-background" disabled={readonly} /></label>
                <label class="flex items-center gap-1" title="gelap"><Icon name="moon" size={14} /><input type="color" name={`td__${name}`} value={hex(values.tokens.dark[name] ?? values.tokens.light[name])} class="h-8 w-10 cursor-pointer rounded border bg-background" disabled={readonly} /></label>
                {#if errors[`tokens.light.${name}`] || errors[`tokens.dark.${name}`]}<span class="col-span-3 text-xs text-destructive">{errors[`tokens.light.${name}`] ?? errors[`tokens.dark.${name}`]}</span>{/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </Card>

  {#if !readonly}
    <div class="flex flex-wrap gap-2">
      <Button type="submit"><Icon name="save" size={16} />{isNew ? 'Buat tema' : 'Simpan'}</Button>
      <Button href="/themes" variant="outline">Kembali</Button>
    </div>
  {/if}
</form>
