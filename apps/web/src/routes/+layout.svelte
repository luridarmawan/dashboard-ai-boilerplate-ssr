<script lang="ts">
// Global shell. Theme tokens, layout regions and components arrive in M2 (FR-L); until then a
// small neutral stylesheet keeps the M1 pages readable and usable without JavaScript.
let { children } = $props();
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

{@render children()}

<style>
  :global(:root) { color-scheme: light; --fg: #1a1a1a; --muted: #666; --line: #ddd; --bg: #fafafa; --card: #fff; --accent: #1d4ed8; --danger: #b91c1c; --ok: #15803d; }
  :global(body) { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  :global(a) { color: var(--accent); }
  :global(main) { max-width: 960px; margin: 0 auto; padding: 1.5rem 1rem; }
  :global(h1) { font-size: 1.5rem; margin: 0 0 1rem; }
  :global(h2) { font-size: 1.15rem; margin: 1.5rem 0 .5rem; }
  :global(table) { width: 100%; border-collapse: collapse; background: var(--card); }
  :global(th), :global(td) { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  :global(th) { font-weight: 600; color: var(--muted); font-size: .85rem; }
  :global(form.stack) { display: grid; gap: .75rem; max-width: 480px; }
  :global(label) { display: grid; gap: .25rem; font-size: .9rem; }
  :global(input:not([type=checkbox])), :global(select), :global(textarea) { font: inherit; padding: .45rem .55rem; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  :global(button), :global(.btn) { font: inherit; padding: .45rem .9rem; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; text-decoration: none; display: inline-block; }
  :global(button.secondary), :global(.btn.secondary) { background: #fff; color: var(--accent); }
  :global(button.danger) { background: var(--danger); border-color: var(--danger); }
  :global(.error) { color: var(--danger); background: #fef2f2; border: 1px solid #fecaca; padding: .5rem .75rem; border-radius: 6px; }
  :global(.notice) { color: var(--ok); background: #f0fdf4; border: 1px solid #bbf7d0; padding: .5rem .75rem; border-radius: 6px; }
  :global(.muted) { color: var(--muted); font-size: .9rem; }
  :global(.row) { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
  :global(.card) { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 1rem; }
  :global(fieldset) { border: 1px solid var(--line); border-radius: 8px; padding: .75rem 1rem; }
  :global(.grid) { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: .35rem .75rem; }
  :global(.check) { display: flex; gap: .4rem; align-items: center; font-size: .9rem; }
  :global(code) { background: #f1f5f9; padding: 0 .3rem; border-radius: 4px; }
</style>
