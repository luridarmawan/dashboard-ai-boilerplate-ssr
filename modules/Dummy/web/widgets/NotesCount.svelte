<script lang="ts">
/**
 * A widget is a plain component (G-19). It receives the dashboard `context` (locale, active
 * tenant, permissions) and renders; it never fetches during SSR. Numbers that need the API are
 * fetched by the module's own page — or, later, by a widget-data hook the core provides.
 */
let { context }: { context?: { locale: string; clientId: string | null } } = $props();
</script>

<div class="grid gap-1" data-testid="widget-dummy">
  <p class="text-3xl font-semibold">📝</p>
  <p class="text-sm text-muted-foreground">
    {context?.locale === 'en' ? 'Sample module widget, filtered by permission.' : 'Widget modul contoh, terfilter izin.'}
    <a href="/m/dummy/notes">{context?.locale === 'en' ? 'Open notes' : 'Buka catatan'}</a>
  </p>
</div>
