<script lang="ts">
let { context }: { context?: { locale: string } } = $props();
const en = $derived(context?.locale === 'en');
</script>

<div class="grid gap-2 text-sm" data-testid="widget-ai">
  <p class="text-muted-foreground">{en ? 'Ask, draft, summarise — with streaming replies and saved history.' : 'Tanya, susun draf, ringkas — balasan streaming, riwayat tersimpan.'}</p>
  <a href="/m/ai/chat" class="font-medium">{en ? 'Open chat' : 'Buka chat'} →</a>
</div>
