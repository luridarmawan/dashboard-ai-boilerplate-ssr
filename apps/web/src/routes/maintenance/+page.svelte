<script lang="ts">
import Csrf from '$lib/components/Csrf.svelte';
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { PageData } from './$types';

/**
 * Maintenance scene (E-10), the sibling of the 404/500 pages: full screen, copy on a translucent
 * panel, no shell — a shell would need a session this visitor may not have. The picture is inline
 * SVG painted with the theme's own tokens, so it follows every theme and mode without an asset;
 * the gears turn only for people who have not asked for reduced motion.
 */
let { data }: { data: PageData } = $props();
const t = useT();
const sourceLabel = $derived(
  data.source === 'env' ? t('maintenance.source.env') : t('maintenance.source.config'),
);
const retryHref = $derived(data.requestedPath ?? '/');
const loginHref = $derived(
  `/auth/login?next=${encodeURIComponent(data.requestedPath ?? data.home)}`,
);
</script>

<svelte:head>
  <title>503 · {t('maintenance.eyebrow')}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main
  class="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-10"
  data-testid="maintenance-page"
  data-maintenance-active={data.active ? 'true' : 'false'}
>
  <!-- Soft backdrop: two blurred discs in the theme's primary and accent, like the clouds behind the robots. -->
  <div aria-hidden="true" class="pointer-events-none absolute inset-0">
    <div class="absolute -top-24 -start-24 h-96 w-96 rounded-full bg-primary/10 blur-3xl"></div>
    <div class="absolute -bottom-32 -end-16 h-[28rem] w-[28rem] rounded-full bg-accent blur-3xl"></div>
  </div>

  <div class="relative flex w-full max-w-5xl flex-col items-center gap-8 md:flex-row md:items-center md:justify-between md:gap-12">
    <!-- The scene: a robot with a wrench, two gears, a progress strip. -->
    <svg
      viewBox="0 0 480 360"
      role="img"
      aria-labelledby="maintenance-scene-title"
      class="maintenance-scene w-full max-w-md shrink-0 md:w-1/2"
    >
      <title id="maintenance-scene-title">{t('maintenance.scene_alt')}</title>
      <!-- floor -->
      <ellipse cx="240" cy="318" rx="210" ry="22" class="fill-muted" />
      <!-- big gear -->
      <g class="gear gear-big" style="transform-origin: 372px 118px">
        <circle cx="372" cy="118" r="44" class="fill-none stroke-primary" stroke-width="14" stroke-dasharray="14 9" />
        <circle cx="372" cy="118" r="30" class="fill-primary" />
        <circle cx="372" cy="118" r="12" class="fill-background" />
      </g>
      <!-- small gear -->
      <g class="gear gear-small" style="transform-origin: 428px 178px">
        <circle cx="428" cy="178" r="26" class="fill-none stroke-primary/70" stroke-width="10" stroke-dasharray="9 7" />
        <circle cx="428" cy="178" r="17" class="fill-primary/70" />
        <circle cx="428" cy="178" r="7" class="fill-background" />
      </g>
      <!-- antenna -->
      <line x1="200" y1="92" x2="200" y2="62" class="stroke-primary" stroke-width="5" stroke-linecap="round" />
      <circle cx="200" cy="56" r="7" class="fill-destructive beacon" />
      <!-- head -->
      <rect x="138" y="90" width="124" height="90" rx="22" class="fill-primary" />
      <rect x="156" y="108" width="88" height="54" rx="12" class="fill-foreground/85" />
      <!-- eyes: two friendly arcs -->
      <path d="M176 142 q10 -14 20 0" class="fill-none stroke-background" stroke-width="5" stroke-linecap="round" />
      <path d="M212 142 q10 -14 20 0" class="fill-none stroke-background" stroke-width="5" stroke-linecap="round" />
      <!-- body -->
      <rect x="150" y="186" width="100" height="92" rx="26" class="fill-primary/80" />
      <circle cx="200" cy="232" r="16" class="fill-background/80" />
      <circle cx="200" cy="232" r="7" class="fill-primary" />
      <!-- left arm, hand closed around the wrench handle -->
      <path d="M152 212 q-40 10 -40 50" class="fill-none stroke-primary/80" stroke-width="18" stroke-linecap="round" />
      <g class="wrench" style="transform-origin: 112px 262px">
        <!-- open-end spanner: a C-shaped head on a long handle -->
        <rect x="106" y="222" width="12" height="86" rx="6" class="fill-foreground/70" />
        <path d="M121 198 A16 16 0 1 0 103 198" class="fill-none stroke-foreground/70" stroke-width="10" stroke-linecap="round" />
      </g>
      <circle cx="112" cy="262" r="13" class="fill-primary/80" />
      <!-- right arm reaching to the gear -->
      <path d="M248 212 q50 -30 84 -56" class="fill-none stroke-primary/80" stroke-width="18" stroke-linecap="round" />
      <circle cx="334" cy="154" r="13" class="fill-primary/80" />
      <!-- legs -->
      <rect x="166" y="276" width="24" height="36" rx="10" class="fill-primary/80" />
      <rect x="210" y="276" width="24" height="36" rx="10" class="fill-primary/80" />
      <ellipse cx="178" cy="312" rx="22" ry="8" class="fill-primary" />
      <ellipse cx="222" cy="312" rx="22" ry="8" class="fill-primary" />
      <!-- sparks -->
      <g class="sparks fill-warning">
        <path d="M300 86 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" />
        <path d="M330 60 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" />
        <path d="M452 110 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" />
      </g>
      <!-- progress strip -->
      <rect x="60" y="334" width="360" height="10" rx="5" class="fill-border" />
      <rect x="60" y="334" width="150" height="10" rx="5" class="fill-primary progress" />
    </svg>

    <div class="flex w-full max-w-lg flex-col items-center gap-3 rounded-3xl border border-border/60 bg-background/70 px-6 py-8 text-center shadow-lg backdrop-blur-[2px] sm:px-10 md:items-start md:text-start">
      <p class="font-mono text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
        <span class="me-2 inline-block rounded-full bg-warning px-2 py-0.5 text-warning-foreground">503</span>{t('maintenance.eyebrow')}
      </p>
      <h1 class="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">{t('maintenance.title')}</h1>
      <p class="text-balance text-lg text-muted-foreground">
        {data.signedIn && !data.exempt ? t('maintenance.signed_in_lead') : t('maintenance.lead')}
      </p>

      {#if data.active && data.exempt}
        <p class="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground" data-testid="maintenance-exempt-note">
          <Icon name="shield" size={14} class="me-1 inline align-[-2px]" />{t('maintenance.exempt_note', { source: sourceLabel })}
        </p>
      {:else if !data.active}
        <p class="rounded-xl border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground" data-testid="maintenance-preview-note">
          <Icon name="info" size={14} class="me-1 inline align-[-2px]" />{t('maintenance.preview_note')}
        </p>
      {/if}

      {#if data.requestedPath}
        <p class="text-xs text-muted-foreground"><code>{data.requestedPath}</code></p>
      {/if}

      <div class="mt-2 flex flex-wrap justify-center gap-3 md:justify-start">
        {#if data.active && data.exempt}
          <Button href={data.home} class="rounded-full px-6"><Icon name="dashboard" size={16} />{t('maintenance.to_dashboard')}</Button>
          {#if data.canOpenSettings}
            <Button href="/settings" variant="outline" class="rounded-full px-6"><Icon name="settings" size={16} />{t('maintenance.to_settings')}</Button>
          {/if}
        {:else if data.signedIn}
          <Button href={retryHref} class="rounded-full px-6"><Icon name="refresh" size={16} />{t('maintenance.retry')}</Button>
          <form method="POST" action="/auth/logout">
            <Csrf token={data.csrf} />
            <Button type="submit" variant="outline" class="rounded-full px-6"><Icon name="logout" size={16} />{t('maintenance.logout')}</Button>
          </form>
        {:else}
          <Button href={retryHref} class="rounded-full px-6"><Icon name="refresh" size={16} />{t('maintenance.retry')}</Button>
          <Button href={loginHref} variant="outline" class="rounded-full px-6" data-testid="maintenance-admin-login"><Icon name="login" size={16} />{t('maintenance.admin_login')}</Button>
        {/if}
      </div>
    </div>
  </div>
</main>

<style>
  @keyframes gear-turn {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes wrench-wave {
    0%,
    100% {
      transform: rotate(-8deg);
    }
    50% {
      transform: rotate(10deg);
    }
  }
  @keyframes beacon-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
  @keyframes progress-slide {
    0% {
      transform: translateX(0);
    }
    100% {
      transform: translateX(210px);
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .gear-big {
      animation: gear-turn 14s linear infinite;
    }
    .gear-small {
      animation: gear-turn 9s linear infinite reverse;
    }
    .wrench {
      animation: wrench-wave 2.6s ease-in-out infinite;
    }
    .beacon {
      animation: beacon-pulse 1.8s ease-in-out infinite;
    }
    .progress {
      animation: progress-slide 3.2s ease-in-out infinite alternate;
    }
  }
</style>
