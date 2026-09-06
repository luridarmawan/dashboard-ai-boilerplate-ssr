<script lang="ts">
import { Tabs } from 'bits-ui';
import type { Snippet } from 'svelte';
import { cn } from '$lib/utils';

/** Tabs; `tabs` = [{ value, label }], `content` snippet receives the active value. */
interface Props {
  tabs: { value: string; label: string }[];
  value?: string;
  class?: string;
  content: Snippet<[string]>;
}
let { tabs, value = $bindable(tabs[0]?.value ?? ''), class: className, content }: Props = $props();
</script>

<Tabs.Root bind:value class={cn('w-full', className)}>
  <Tabs.List class="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
    {#each tabs as t (t.value)}
      <Tabs.Trigger
        value={t.value}
        class="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs"
      >
        {t.label}
      </Tabs.Trigger>
    {/each}
  </Tabs.List>
  {#each tabs as t (t.value)}
    <Tabs.Content value={t.value} class="mt-3">{@render content(t.value)}</Tabs.Content>
  {/each}
</Tabs.Root>
