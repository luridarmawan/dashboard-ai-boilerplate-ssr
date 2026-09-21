<script lang="ts">
import type { Snippet } from 'svelte';
import { enhance } from '$app/forms';
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button, Checkbox, Field, Input, PasswordInput, Select, Textarea } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import { cn } from '$lib/utils';
import type { FieldDef, FormErrors, FormValues } from './fields.ts';

/**
 * Declarative form (L-17). Renders `fields` into a real <form method="POST"> with the CSRF
 * field, current values and per-field errors; the action validates with the shared schema.
 * `extra` and `aside` let a page add its own markup without forking the builder.
 */
interface Props {
  fields: FieldDef[];
  values?: FormValues;
  errors?: FormErrors;
  csrf: string;
  action?: string;
  method?: 'POST';
  submitLabel?: string;
  cancelHref?: string;
  cancelLabel?: string;
  columns?: 1 | 2 | 3;
  /** Classes for the field GRID (not the <form>): column template, width, `[&_button]:…`. */
  class?: string;
  readonly?: boolean;
  /**
   * Post over fetch instead of reloading the page (L-22: the same form still posts the ordinary
   * way when JavaScript never arrives — this only takes the shorter route when it can). The
   * action, its validation and its result stay exactly the same; what changes is that the page
   * is not thrown away, so scroll position and anything typed stay put.
   */
  ajax?: boolean;
  /** A form-level error banner (e.g. the API's message). */
  error?: string | null;
  notice?: string | null;
  extra?: Snippet;
  /**
   * A grid item of the page's own — a product photo, a preview, a help panel — rendered WITHOUT a
   * wrapper, so the snippet's root element carries its own placement (`lg:col-start-3 …`) and the
   * fields flow around it. For markup that simply follows the fields, use `extra`.
   */
  aside?: Snippet;
  footer?: Snippet;
}
const t = useT();
let {
  fields,
  values = {},
  errors = {},
  csrf,
  action,
  method = 'POST',
  submitLabel = t('common.save'),
  cancelHref,
  cancelLabel = t('common.cancel'),
  columns = 1,
  class: className,
  readonly = false,
  ajax = false,
  error = null,
  notice = null,
  extra,
  aside,
  footer,
}: Props = $props();

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
/** Eden revives ISO dates into Date objects; native inputs want `YYYY-MM-DD` (date) or ISO text. */
const val = (f: FieldDef, v: unknown) =>
  v instanceof Date ? (f.type === 'date' ? v.toISOString().slice(0, 10) : v.toISOString()) : str(v);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
/**
 * Written out rather than composed: Tailwind reads these class names from the source, so a
 * template string like `sm:col-span-${n}` would compile to nothing. A three-column form stays
 * two-column until `lg` — three inputs side by side are unreadable on a tablet.
 */
const GRID_COLS = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3' } as const;
const COL_SPAN = { 1: '', 2: 'sm:col-span-2', 3: 'sm:col-span-2 lg:col-span-3' } as const;
/** A field never spans past the form's own column count. */
const spanOf = (f: FieldDef) =>
  Math.min(f.span ?? (f.type === 'text' || f.type === 'markdown' ? columns : 1), columns) as
    | 1
    | 2
    | 3;
const full = $derived(COL_SPAN[columns]);
const hasFile = $derived(fields.some((f) => f.type === 'file'));

let submitting = $state(false);
/**
 * Flipped on mount: a submit that lands before hydration takes the plain form action, which is
 * correct but is the OTHER path — the attribute lets a test tell which one answered.
 */
let hydrated = $state(false);
$effect(() => {
  hydrated = true;
});
/**
 * `use:` cannot be applied conditionally, so the action itself decides: without `ajax` it returns
 * nothing and the form stays a plain POST. `update({ reset: false })` re-runs `load` and applies
 * the action result in place — without it the fields would snap back to the values the page was
 * rendered with.
 */
function submitOverFetch(node: HTMLFormElement) {
  if (!ajax) return;
  return enhance(node, () => {
    submitting = true;
    return async ({ update }) => {
      await update({ reset: false });
      submitting = false;
    };
  });
}
</script>

<form
  {method}
  {action}
  enctype={hasFile ? 'multipart/form-data' : undefined}
  class="flex flex-col gap-4"
  data-enhanced={ajax && hydrated ? 'true' : null}
  aria-busy={submitting ? 'true' : undefined}
  novalidate={false}
  use:submitOverFetch
>
  <Csrf token={csrf} />
  <!-- Outside the grid on purpose: as a grid item a banner takes the first row, and everything
       placed by hand (an `aside` at `row-start-1`) would collide with it the moment a save
       succeeded — the fields would reflow around the aside instead of beside it. -->
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}

  <div class={cn('grid gap-4', GRID_COLS[columns], className)}>
    <!-- Before the fields, so its own placement classes decide where it lands and the auto-placed
         fields flow around it (and so a screen reader meets it in visual order). -->
    {@render aside?.()}

    {#each fields as f (f.name)}
      {@const id = `f-${f.name}`}
      {@const err = errors[f.name] ?? null}
      {#if f.type === 'hidden'}
        <input type="hidden" name={f.name} value={str(values[f.name])} />
      {:else if f.type === 'boolean'}
        <div class={cn('flex items-center gap-2 self-end pb-2', COL_SPAN[spanOf(f)])}>
          <Checkbox {id} name={f.name} checked={Boolean(values[f.name])} disabled={readonly || f.disabled} aria-invalid={err ? 'true' : undefined} />
          <label for={id} class="text-sm">{f.label ?? f.name}</label>
          {#if err}<p class="text-sm text-destructive" role="alert">{err}</p>{/if}
        </div>
      {:else}
        <Field label={f.label ?? f.name} for={id} hint={f.hint} error={err} required={f.required} class={cn(COL_SPAN[spanOf(f)])}>
          {#if f.type === 'text' || f.type === 'markdown'}
            <Textarea {id} name={f.name} rows={f.rows ?? (f.type === 'markdown' ? 8 : 3)} placeholder={f.placeholder} required={f.required} disabled={readonly || f.disabled} maxlength={f.maxlength} value={str(values[f.name])} aria-invalid={err ? 'true' : undefined} class={f.type === 'markdown' ? 'font-mono text-xs' : ''} />
            {#if f.type === 'markdown'}<p class="text-xs text-muted-foreground">Markdown</p>{/if}
          {:else if f.type === 'select'}
            <Select {id} name={f.name} required={f.required} disabled={readonly || f.disabled} value={str(values[f.name])} aria-invalid={err ? 'true' : undefined}>
              {#if !f.required}<option value="">—</option>{/if}
              {#each f.options ?? [] as o (o.value)}<option value={o.value} selected={str(values[f.name]) === o.value}>{o.label}</option>{/each}
            </Select>
          {:else if f.type === 'multiselect' && f.multiselectAs === 'select'}
            <Select {id} name={f.name} multiple disabled={readonly || f.disabled} class="h-auto min-h-24">
              {#each f.options ?? [] as o (o.value)}<option value={o.value} selected={list(values[f.name]).includes(o.value)}>{o.label}</option>{/each}
            </Select>
          {:else if f.type === 'multiselect'}
            <!-- A long option list scrolls inside its own box: with hundreds of groups the grid would
                 otherwise push the form's buttons far below the fold. -->
            <div class="grid max-h-72 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-1 overflow-y-auto rounded-md border p-3" role="group" aria-labelledby={`${id}-label`}>
              {#each f.options ?? [] as o (o.value)}
                <label class="flex items-center gap-2 text-sm">
                  <Checkbox name={f.name} value={o.value} checked={list(values[f.name]).includes(o.value)} disabled={readonly || f.disabled} />
                  {o.label}
                </label>
              {:else}
                <span class="text-sm text-muted-foreground">—</span>
              {/each}
            </div>
          {:else if f.type === 'file'}
            <Input {id} type="file" name={f.name} accept={f.accept} required={f.required} disabled={readonly || f.disabled} />
          {:else if f.type === 'password'}
            <!-- Never seeded with a value; carries its own show/hide toggle. -->
            <PasswordInput
              {id}
              name={f.name}
              placeholder={f.placeholder}
              required={f.required}
              disabled={readonly || f.disabled}
              autocomplete={f.autocomplete}
              minlength={f.minlength}
              maxlength={f.maxlength}
              pattern={f.pattern}
              value=""
              aria-invalid={err ? 'true' : undefined}
            />
          {:else}
            <Input
              {id}
              name={f.name}
              type={f.type === 'string' ? 'text' : f.type === 'date' ? 'date' : f.type}
              placeholder={f.placeholder}
              required={f.required}
              disabled={readonly || f.disabled}
              autocomplete={f.autocomplete}
              min={f.min}
              max={f.max}
              step={f.step}
              minlength={f.minlength}
              maxlength={f.maxlength}
              pattern={f.pattern}
              value={val(f, values[f.name])}
              aria-invalid={err ? 'true' : undefined}
            />
          {/if}
        </Field>
      {/if}
    {/each}

    {#if extra}<div class={full}>{@render extra()}</div>{/if}

    <div class={cn('flex flex-wrap items-center gap-3 pt-1', full)}>
      {#if footer}
        {@render footer()}
      {:else}
        {#if !readonly}
          <Button type="submit" disabled={submitting}>
            {#if submitting}<Icon name="refresh" size={16} class="animate-spin" />{/if}
            {submitLabel}
          </Button>
        {/if}
        {#if cancelHref}<a href={cancelHref} class="text-sm">{cancelLabel}</a>{/if}
      {/if}
    </div>
  </div>
</form>
