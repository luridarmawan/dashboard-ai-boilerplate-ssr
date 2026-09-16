<script lang="ts">
import { onMount } from 'svelte';
import Icon from './Icon.svelte';

/**
 * The clock that belongs to a `timezone` configuration field: what a wall clock reads RIGHT NOW
 * in the zone the operator has in that field. Rendered on the server first — so it is correct
 * and readable with no JavaScript — then ticked every second in the browser and re-read from the
 * field while it is being typed, which is what makes "Asia/Makassar" visible before it is saved.
 *
 * Presentational only: the wording arrives as props, so the component stays usable by modules
 * without dragging the settings catalogue into their bundle.
 */
interface Props {
  /** Zone as it currently stands in the field. Empty falls back to `fallback`. */
  timezone?: string | null;
  /** Zone the server resolved for this scope, used while the field is empty. */
  fallback?: string | null;
  /** UI locale, `id` or `en` — decides how the date is spelled out. */
  locale?: string;
  /** Heading above the clock, e.g. "Waktu saat ini". */
  label: string;
  /** Shown instead of the clock when the zone is not a name `Intl` knows. */
  invalidText: string;
  class?: string;
}
let {
  timezone = null,
  fallback = null,
  locale = 'id',
  label,
  invalidText,
  class: className = '',
}: Props = $props();

const tag = $derived(locale === 'en' ? 'en-US' : 'id-ID');
const zone = $derived((timezone ?? '').trim() || (fallback ?? '').trim() || systemZone());
const valid = $derived(isValidZone(zone));

/** The instant being displayed. The server renders its own `now`; the browser takes over on mount. */
let now = $state(new Date());
onMount(() => {
  const id = setInterval(() => {
    now = new Date();
  }, 1000);
  return () => clearInterval(id);
});

function systemZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function isValidZone(z: string): boolean {
  if (!z || z.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

function part(opts: Intl.DateTimeFormatOptions): string {
  if (!valid) return '';
  return new Intl.DateTimeFormat(tag, { timeZone: zone, ...opts }).format(now);
}

const time = $derived(
  part({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
);
const date = $derived(part({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
/** "GMT+07:00" — read off the formatter so DST is whatever the zone says it is today. */
const offset = $derived(
  valid
    ? (new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
        .formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value ?? '')
    : '',
);
</script>

<div
  class={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/40 px-4 py-3 ${className}`}
  data-testid="timezone-clock"
  data-timezone={zone}
>
  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
    <Icon name="clock" size={18} />
  </span>
  {#if valid}
    <div class="min-w-0">
      <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p class="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        <!-- Tabular figures: the seconds tick without the line jittering. -->
        <span class="font-mono text-2xl font-semibold tabular-nums leading-none text-foreground" data-testid="timezone-clock-time">{time}</span>
        <span class="text-sm text-muted-foreground">{date}</span>
      </p>
    </div>
    <p class="text-xs text-muted-foreground">{zone}{offset ? ` · ${offset}` : ''}</p>
  {:else}
    <p class="text-sm text-destructive" role="alert">{invalidText}</p>
  {/if}
</div>
