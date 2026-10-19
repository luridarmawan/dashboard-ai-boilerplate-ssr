<script lang="ts">
/**
 * WhatsApp mark for the stroke icon sets — Lucide ships no brand logos. Same props as a Lucide
 * glyph (`size`, `strokeWidth`, `class`, aria attributes) so `<Icon>` treats it like any other.
 * Paths from Tabler Icons `brand-whatsapp` (MIT, https://tabler.io/icons).
 */
let {
  size = 24,
  strokeWidth = 2,
  class: className = '',
  weight: _weight,
  ...rest
}: {
  size?: number | string;
  strokeWidth?: number | string;
  class?: string;
  /** Passed by `<Icon>` for fill sets; meaningless for a stroke glyph. */
  weight?: unknown;
  [attr: string]: unknown;
} = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  {...rest}
>
  <path d="M3 21l1.65 -3.8a9 9 0 1 1 3.4 2.9l-5.05 .9" />
  <path d="M9 10a.5 .5 0 0 0 1 0v-1a.5 .5 0 0 0 -1 0v1a5 5 0 0 0 5 5h1a.5 .5 0 0 0 0 -1h-1a.5 .5 0 0 0 0 1" />
</svg>
