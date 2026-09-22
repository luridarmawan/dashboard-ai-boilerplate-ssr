<script lang="ts">
import type { HTMLInputAttributes } from 'svelte/elements';
import Icon from '$lib/components/Icon.svelte';
import { useT } from '$lib/i18n';
import { cn } from '$lib/utils';
import Input from './Input.svelte';

/**
 * A password field with a show/hide toggle. The toggle is a JavaScript nicety, so it is rendered
 * only once the component has mounted: without a script it could do nothing, and a dead button
 * beside the field is worse than none. The field itself is untouched either way — same `name`,
 * same value on submit; `type` is the only thing the toggle changes.
 *
 * `plain` is for the auth pages, whose fields take their look from app.css as CLASS-LESS elements
 * (`input:not([class])`). That is also why this component has no `<style>` block: Svelte scoping
 * would hand its hash class to the input — in dev, vite-plugin-svelte injects ` *{}` for HMR and
 * every element gets it — and the border, height and fill would vanish. The room for the toggle
 * is an inline style there, a utility class on the dashboard `Input`.
 */
interface Props extends Omit<HTMLInputAttributes, 'type' | 'class'> {
  /** Class-less input styled by app.css (auth pages) instead of the dashboard `Input`. */
  plain?: boolean;
  class?: string | undefined;
}
let { plain = false, class: className, value, ...rest }: Props = $props();
const t = useT();

let show = $state(false);
let mounted = $state(false);
$effect(() => {
  mounted = true;
});
const type = $derived(show ? 'text' : 'password');
const label = $derived(t(show ? 'common.hide_password' : 'common.show_password'));
</script>

<div class="relative">
  {#if plain}
    <!-- Logical property: RTL puts the toggle at the start. -->
    <input {type} {value} {...rest} style="width: 100%; padding-inline-end: 2.5rem" />
  {:else}
    <Input {type} {value} class={cn('pe-10', className)} {...rest} />
  {/if}
  {#if mounted}
    <button
      type="button"
      class="absolute end-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
      onclick={() => (show = !show)}
      aria-pressed={show}
      aria-controls={rest.id}
      aria-label={label}
      title={label}
      data-testid="password-toggle"
    >
      <Icon name={show ? 'eye-off' : 'eye'} size={18} />
    </button>
  {/if}
</div>
