<script lang="ts">
let { context }: { context?: { locale: string } } = $props();
</script>

<div class="grid gap-2 text-sm" data-testid="widget-hello">
  <a href="/m/hello/notes" class="font-medium">{context?.locale === 'en' ? 'Manage notes' : 'Kelola notes'} →</a>
</div>
