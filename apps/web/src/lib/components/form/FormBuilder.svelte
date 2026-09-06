<script lang="ts">
import type { Snippet } from 'svelte';
import Csrf from '$lib/components/Csrf.svelte';
import { Button, Checkbox, Field, Input, Select, Textarea } from '$lib/components/ui';
import { cn } from '$lib/utils';
import type { FieldDef, FormErrors, FormValues } from './fields.ts';

/**
 * Declarative form (L-17). Renders `fields` into a real <form method="POST"> with the CSRF
 * field, current values and per-field errors; the action validates with the shared schema.
 * `slots` lets a page inject custom markup after a named field without forking the builder.
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
  columns?: 1 | 2;
  class?: string;
  readonly?: boolean;
  /** A form-level error banner (e.g. the API's message). */
  error?: string | null;
  notice?: string | null;
  extra?: Snippet;
  footer?: Snippet;
}
let {
  fields,
  values = {},
  errors = {},
  csrf,
  action,
  method = 'POST',
  submitLabel = 'Simpan',
  cancelHref,
  cancelLabel = 'Batal',
  columns = 1,
  class: className,
  readonly = false,
  error = null,
  notice = null,
  extra,
  footer,
}: Props = $props();

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
/** Eden revives ISO dates into Date objects; native inputs want `YYYY-MM-DD` (date) or ISO text. */
const val = (f: FieldDef, v: unknown) =>
  v instanceof Date ? (f.type === 'date' ? v.toISOString().slice(0, 10) : v.toISOString()) : str(v);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const spanOf = (f: FieldDef) => f.span ?? (f.type === 'text' || f.type === 'markdown' ? 2 : 1);
const hasFile = $derived(fields.some((f) => f.type === 'file'));
</script>

<form
  {method}
  {action}
  enctype={hasFile ? 'multipart/form-data' : undefined}
  class={cn('grid gap-4', columns === 2 && 'sm:grid-cols-2', className)}
  novalidate={false}
>
  <Csrf token={csrf} />
  {#if error}<p class="error sm:col-span-2" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice sm:col-span-2" role="status">{notice}</p>{/if}

  {#each fields as f (f.name)}
    {@const id = `f-${f.name}`}
    {@const err = errors[f.name] ?? null}
    {#if f.type === 'hidden'}
      <input type="hidden" name={f.name} value={str(values[f.name])} />
    {:else if f.type === 'boolean'}
      <div class={cn('flex items-center gap-2 self-end pb-2', spanOf(f) === 2 && 'sm:col-span-2')}>
        <Checkbox {id} name={f.name} checked={Boolean(values[f.name])} disabled={readonly || f.disabled} aria-invalid={err ? 'true' : undefined} />
        <label for={id} class="text-sm">{f.label ?? f.name}</label>
        {#if err}<p class="text-sm text-destructive" role="alert">{err}</p>{/if}
      </div>
    {:else}
      <Field label={f.label ?? f.name} for={id} hint={f.hint} error={err} required={f.required} class={cn(spanOf(f) === 2 && 'sm:col-span-2')}>
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
          <div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-1 rounded-md border p-3" role="group" aria-labelledby={`${id}-label`}>
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
            value={f.type === 'password' ? '' : val(f, values[f.name])}
            aria-invalid={err ? 'true' : undefined}
          />
        {/if}
      </Field>
    {/if}
  {/each}

  {#if extra}<div class="sm:col-span-2">{@render extra()}</div>{/if}

  <div class={cn('flex flex-wrap items-center gap-3 pt-1', columns === 2 && 'sm:col-span-2')}>
    {#if footer}
      {@render footer()}
    {:else}
      {#if !readonly}<Button type="submit">{submitLabel}</Button>{/if}
      {#if cancelHref}<a href={cancelHref} class="text-sm">{cancelLabel}</a>{/if}
    {/if}
  </div>
</form>
