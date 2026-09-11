<script lang="ts">
import { enhance } from '$app/forms';
import { page } from '$app/state';
import { useT } from '$lib/i18n';
import Csrf from './Csrf.svelte';
import Icon from './Icon.svelte';

/**
 * Collapse / expand the sidebar rail (PRD F-8). A layout that owns a sidebar renders this in its
 * rail header — core layouts and module ones alike (`@core/ui`, extension point 10) — and nothing
 * else in the shell changes, because the state is an attribute on <html> (`data-sidebar`) that the
 * layout's own CSS keys off.
 *
 * It takes no props — like an aside, it reads what it needs from `page.data` (the shell puts
 * `csrf`, `path` and `sidebarCollapsed` there). Base: a form posting to /sidebar, which writes the
 * cookie + profile and redirects back, so it works with JavaScript disabled (L-22). Enhanced: the
 * attribute flips instantly and the same POST goes out in the background — no reload, no flicker.
 */
const t = useT();
type ShellData = { csrf?: string; path?: string; sidebarCollapsed?: boolean } | undefined;
const data = $derived(page.data as ShellData);
/**
 * Local so the enhanced path can flip without waiting for (or triggering) a reload. It is seeded
 * at creation, not in an effect: effects do not run during SSR, and the server-rendered button
 * must already say (and post) the right thing for the no-JavaScript path.
 */
let collapsed = $state((page.data as ShellData)?.sidebarCollapsed ?? false);
// Navigation brings a fresh answer from the server; adopt it (this never runs on the server).
$effect(() => {
  collapsed = data?.sidebarCollapsed ?? false;
});
const next = $derived(collapsed ? 'expanded' : 'collapsed');
const label = $derived(collapsed ? t('shell.sidebar_expand') : t('shell.sidebar_collapse'));
</script>

<form
  method="POST"
  action="/sidebar"
  data-testid="sidebar-toggle-form"
  use:enhance={() => {
    // Optimistic: <html> carries the state, so flipping the attribute IS the whole re-layout.
    const state = next;
    collapsed = state === 'collapsed';
    document.documentElement.setAttribute('data-sidebar', state);
    // Nothing to re-render: no invalidation, and the redirect the action returns is ignored.
    return async () => {};
  }}
>
  <Csrf token={data?.csrf ?? ''} />
  <input type="hidden" name="back" value={data?.path ?? '/dashboard'} />
  <input type="hidden" name="state" value={next} />
  <button
    type="submit"
    title={label}
    aria-label={label}
    aria-expanded={!collapsed}
    aria-controls="sidebar-rail"
    data-testid="sidebar-toggle"
    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  >
    <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={18} class="rtl:rotate-180" />
  </button>
</form>
