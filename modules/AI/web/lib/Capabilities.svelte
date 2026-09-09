<script lang="ts">
/**
 * Capability badges for a provider (AI-Roadmap §3, F1). One row of small badges: the endpoint the
 * provider prefers, then stream / reasoning / tools, then the recommendation star. A supported
 * capability is filled, an unsupported one stays outline-grey — the point is that an admin can
 * compare two providers at a glance without opening either.
 *
 * `capabilities` is null for a provider that has never been probed; the caller shows nothing then.
 */
import { Badge } from '$lib/components/ui';
import { useT } from '$lib/i18n';

interface Caps {
  endpoints: { responses: boolean; chatCompletions: boolean };
  stream: { supported: boolean };
  reasoning: { supported: boolean };
  tools: { supported: boolean };
}

let {
  capabilities,
  recommended = false,
  preferredEndpoint = null,
  compact = false,
}: {
  capabilities: Caps | null;
  recommended?: boolean;
  preferredEndpoint?: string | null;
  compact?: boolean;
} = $props();

const t = useT();
const endpoint = $derived(
  preferredEndpoint ?? (capabilities?.endpoints.responses ? 'responses' : 'chat_completions'),
);
const flags = $derived(
  capabilities
    ? [
        { key: 'stream', on: capabilities.stream.supported, label: t('ai.providers.probe_stream') },
        {
          key: 'reasoning',
          on: capabilities.reasoning.supported,
          label: t('ai.providers.probe_reasoning'),
        },
        { key: 'tools', on: capabilities.tools.supported, label: t('ai.providers.probe_tools') },
      ]
    : [],
);
</script>

{#if capabilities}
  <span class="inline-flex flex-wrap items-center gap-1">
    <Badge variant={endpoint === 'responses' ? 'success' : 'secondary'}>
      {endpoint === 'responses' ? '/responses' : '/chat'}
    </Badge>
    {#each flags as f (f.key)}
      <Badge variant={f.on ? 'success' : 'outline'}>
        <span class={f.on ? '' : 'text-muted-foreground line-through'}>{f.label}</span>
      </Badge>
    {/each}
    {#if recommended}
      <span title={t('ai.providers.recommended_hint')}>
        <Badge variant="warning">★{#if !compact} {t('ai.providers.recommended')}{/if}</Badge>
      </span>
    {/if}
  </span>
{:else}
  <span class="text-xs text-muted-foreground">{t('ai.providers.never')}</span>
{/if}
