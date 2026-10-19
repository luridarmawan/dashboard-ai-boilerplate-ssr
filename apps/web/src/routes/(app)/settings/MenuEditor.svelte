<script lang="ts">
import { formatSiteMenu, parseSiteMenu, type SiteMenuItem } from '@core/module-kit/site-menu';
import { onMount } from 'svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button, Input, Textarea } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/**
 * Editor for a `menu` setting. The form field is ALWAYS the outline textarea — that is what gets
 * posted, and with JavaScript off it is the whole editor. With JavaScript the rows below drive
 * it: each edit re-serialises the rows into the textarea, so the server sees one format either
 * way and validates it (line numbers in its errors match the outline). A value the rows cannot
 * represent (an outline with a syntax error) leaves the editor in text mode until it parses.
 */
let {
  id,
  name,
  value,
  maxDepth,
  suggestions = [],
}: {
  id: string;
  name: string;
  value: unknown;
  /** Nesting the field allows (the field's `max`); 1 = a flat list. */
  maxDepth: number;
  /** Site paths offered while typing a link. */
  suggestions?: readonly string[];
} = $props();
const t = useT();

interface Row {
  key: number;
  depth: number;
  id: string;
  en: string;
  href: string;
}

let seq = 0;
const initial = (() => {
  const r = parseSiteMenu(value, maxDepth);
  return r.ok ? formatSiteMenu(r.items) : typeof value === 'string' ? value : '';
})();
let text = $state(initial);
let rows = $state<Row[]>([]);
let visual = $state(false);
let textMode = $state(false);

function flatten(items: readonly SiteMenuItem[], depth = 0): Row[] {
  return items.flatMap((it) => [
    {
      key: seq++,
      depth,
      id: it.label.id,
      en: it.label.en === it.label.id ? '' : it.label.en,
      href: it.href ?? '',
    },
    ...flatten(it.children, depth + 1),
  ]);
}

/** Rows → outline. Characters the outline gives meaning to are dropped from labels. */
function serialize(list: readonly Row[]): string {
  return list
    .filter((r) => r.id.trim())
    .map((r) => {
      const clean = (s: string) => s.replace(/->|\|/g, ' ').trim();
      const label = r.en.trim() ? `${clean(r.id)} | ${clean(r.en)}` : clean(r.id);
      return `${'  '.repeat(r.depth)}${label}${r.href.trim() ? ` -> ${r.href.trim()}` : ''}`;
    })
    .join('\n');
}

function fromText(): boolean {
  const r = parseSiteMenu(text, maxDepth);
  if (!r.ok) return false;
  rows = flatten(r.items);
  return true;
}

function commit() {
  text = serialize(rows);
}

/** The row and every row nested under it. */
function blockEnd(i: number): number {
  const d = rows[i]?.depth ?? 0;
  let j = i + 1;
  while (j < rows.length && (rows[j]?.depth ?? 0) > d) j++;
  return j;
}

function add() {
  rows.push({ key: seq++, depth: 0, id: '', en: '', href: '' });
}

function remove(i: number) {
  rows.splice(i, blockEnd(i) - i);
  commit();
}

function shift(i: number, by: 1 | -1) {
  const row = rows[i];
  if (!row) return;
  const end = blockEnd(i);
  const block = rows.slice(i, end);
  const deepest = Math.max(...block.map((r) => r.depth));
  if (by === 1) {
    // A row can only become a child of the row above it, and the block must stay within depth.
    const above = rows[i - 1];
    if (!above || above.depth < row.depth || deepest + 1 >= maxDepth) return;
  } else if (row.depth === 0) return;
  for (const r of block) r.depth += by;
  commit();
}

function move(i: number, dir: 1 | -1) {
  const row = rows[i];
  if (!row) return;
  const end = blockEnd(i);
  if (dir === -1) {
    // Swap with the previous sibling block.
    let j = i - 1;
    while (j >= 0 && (rows[j]?.depth ?? 0) > row.depth) j--;
    if (j < 0 || rows[j]?.depth !== row.depth) return;
    const block = rows.splice(i, end - i);
    rows.splice(j, 0, ...block);
  } else {
    if (rows[end]?.depth !== row.depth) return;
    const nextEnd = blockEnd(end);
    const next = rows.splice(end, nextEnd - end);
    rows.splice(i, 0, ...next);
  }
  commit();
}

function toggleText() {
  if (textMode) {
    if (!fromText()) return;
    textMode = false;
  } else {
    commit();
    textMode = true;
  }
}

onMount(() => {
  visual = true;
  textMode = !fromText();
});

const listId = $derived(`${id}-paths`);
</script>

<div class="grid gap-2" data-testid={`menu-editor-${name}`}>
  {#if visual && !textMode}
    <ol class="grid gap-1.5">
      {#each rows as row, i (row.key)}
        <li class="flex flex-wrap items-center gap-1.5 rounded-md border bg-card p-1.5" style={`margin-inline-start: ${row.depth * 1.5}rem`}>
          <Input class="h-8 min-w-28 flex-1" bind:value={row.id} oninput={commit} placeholder={t('settings.menu_label_id')} aria-label={t('settings.menu_label_id')} maxlength={80} />
          <Input class="h-8 min-w-28 flex-1" bind:value={row.en} oninput={commit} placeholder={t('settings.menu_label_en')} aria-label={t('settings.menu_label_en')} maxlength={80} />
          <Input class="h-8 min-w-40 flex-[1.5]" bind:value={row.href} oninput={commit} placeholder={t('settings.menu_href')} aria-label={t('settings.menu_href')} list={listId} maxlength={512} />
          <div class="flex items-center">
            <Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => move(i, -1)} aria-label={t('settings.menu_up')} title={t('settings.menu_up')}><Icon name="chevron-up" size={16} /></Button>
            <Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => move(i, 1)} aria-label={t('settings.menu_down')} title={t('settings.menu_down')}><Icon name="chevron-down" size={16} /></Button>
            {#if maxDepth > 1}
              <Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => shift(i, -1)} aria-label={t('settings.menu_outdent')} title={t('settings.menu_outdent')}><Icon name="chevron-left" size={16} class="rtl:rotate-180" /></Button>
              <Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => shift(i, 1)} aria-label={t('settings.menu_indent')} title={t('settings.menu_indent')}><Icon name="chevron-right" size={16} class="rtl:rotate-180" /></Button>
            {/if}
            <Button variant="ghost" size="icon" class="h-8 w-8 text-destructive" onclick={() => remove(i)} aria-label={t('settings.menu_remove')} title={t('settings.menu_remove')}><Icon name="trash" size={16} /></Button>
          </div>
        </li>
      {:else}
        <li class="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{t('settings.menu_empty')}</li>
      {/each}
    </ol>
    <datalist id={listId}>{#each suggestions as s (s)}<option value={s}></option>{/each}</datalist>
  {/if}
  <!-- The real form field: hidden behind the rows when they can represent it, never removed. -->
  <Textarea {id} {name} bind:value={text} rows={Math.min(14, Math.max(4, text.split('\n').length + 1))} class={`font-mono text-xs ${visual && !textMode ? 'hidden' : ''}`} spellcheck={false} />
  {#if visual}
    <div class="flex flex-wrap items-center gap-2">
      {#if !textMode}
        <Button variant="outline" size="sm" onclick={add}><Icon name="plus" size={16} /> {t('settings.menu_add')}</Button>
      {/if}
      <Button variant="ghost" size="sm" onclick={toggleText}>{textMode ? t('settings.menu_as_rows') : t('settings.menu_as_text')}</Button>
      {#if textMode && parseSiteMenu(text, maxDepth).ok === false}
        <span class="text-xs text-destructive">{t('settings.menu_text_invalid')}</span>
      {/if}
    </div>
  {/if}
</div>
