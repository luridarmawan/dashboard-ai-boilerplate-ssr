<script lang="ts">
import { useT } from '$lib/i18n';

/**
 * A widget is rendered inside the dashboard, so it reads the active locale's catalogue from
 * context like any other component (K-6) — the `context` prop it also receives carries the
 * tenant and the caller's permissions, for widgets that need them.
 */
const t = useT();
</script>

<div class="grid gap-2 text-sm" data-testid="widget-hello">
  <a href="/m/hello/notes" class="font-medium">{t('hello.widget.manage')} →</a>
</div>
