<script lang="ts">
import Icon from '$lib/components/Icon.svelte';
import { Button } from '$lib/components/ui';
import { useT } from '$lib/i18n';
import type { PageData } from './$types';

/**
 * The built-in landing page — the safe front door (F-6). It lives by the same rules as a module's
 * landing (R-7): no literal colours, only theme tokens; no literal copy, only i18n keys (the
 * headline and lead are the deploy-time `APP_LANDING_TITLE` / `APP_LANDING_LEAD` overrides); fully
 * server-rendered, no state, nothing on the render path needs JavaScript. The dashboard "preview" is
 * drawn from tokens, so it restyles with every theme and costs no image request.
 */
let { data }: { data: PageData } = $props();
const t = useT();
const title = $derived(t('landing.title'));
const description = $derived(t('landing.meta.description'));
const siteName = $derived(data.app.name || t('app.name'));
const ld = $derived(
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: title,
    url: `${data.origin}/`,
    description,
  }),
);
const pillars = [
  { k: 'p1', icon: 'plug' },
  { k: 'p2', icon: 'monitor' },
  { k: 'p3', icon: 'puzzle' },
  { k: 'p4', icon: 'database' },
  { k: 'p5', icon: 'server' },
] as const;
const features = [
  { k: 'f1', icon: 'shield' },
  { k: 'f2', icon: 'building' },
  { k: 'f3', icon: 'palette' },
  { k: 'f4', icon: 'language' },
  { k: 'f5', icon: 'sparkles' },
  { k: 'f6', icon: 'chart-line' },
  { k: 'f7', icon: 'check-double' },
] as const;
/** Command per step is developer-facing and identical in every language, like a code sample. */
const steps = [
  { k: 's1', cmd: 'bun install && bun db:migrate && bun db:seed && bun dev' },
  { k: 's2', cmd: 'bun modgen && bun modules:sync' },
  { k: 's3', cmd: 'docker compose --env-file .env.prod -f compose.prod.yml up -d' },
] as const;
/** Bar heights of the token-drawn chart in the preview (percent), fixed so SSR and CSR agree. */
const bars = [42, 58, 51, 74, 66, 88, 79, 95] as const;
/** `as const` like the lists above: `k` must stay a literal, or `landing.hero.${k}` is not a MessageKey. */
const stats = $derived([
  { k: 'stat_modules', value: data.api ? String(data.api.modules.length) : '—' },
  { k: 'stat_locales', value: String(data.localeCount) },
  { k: 'stat_themes', value: String(data.themeCount) },
] as const);
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={`${data.origin}/`} />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={`${data.origin}/`} />
  <meta property="og:site_name" content={siteName} />
  <!-- Share preview (R-4): the deploy ships one image at /og-image.jpg (apps/web/static); absolute URL as the crawlers require. -->
  <meta property="og:image" content={`${data.origin}/og-image.jpg`} />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1672" />
  <meta property="og:image:height" content="941" />
  <meta property="og:image:alt" content={title} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content={`${data.origin}/og-image.jpg`} />
  {@html `<script type="application/ld+json">${ld}</script>`}
</svelte:head>

<!-- hero -->
<section class="relative overflow-hidden" data-testid="landing-hero">
  <div class="pointer-events-none absolute -end-32 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" aria-hidden="true"></div>
  <div class="pointer-events-none absolute -bottom-24 -start-24 h-80 w-80 rounded-full bg-accent blur-3xl" aria-hidden="true"></div>
  <div class="relative mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-14 md:grid-cols-[1.05fr_1fr] md:items-center md:pt-24">
    <div>
      <p class="mb-5 inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground backdrop-blur"><span class="h-1.5 w-1.5 rounded-full bg-primary"></span>{t('landing.hero.eyebrow')}</p>
      <h1 class="text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">{title}</h1>
      <p class="mt-4 text-lg font-medium text-primary">{t('app.tagline')}</p>
      <p class="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">{t('landing.hero.subtitle')}</p>
      <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button href="/auth/login" size="lg" class="w-full rounded-full px-6 sm:w-auto"><Icon name="login" size={18} />{t('landing.hero.cta')}</Button>
        {#if data.signupEnabled}
          <Button href="/auth/register" size="lg" variant="outline" class="w-full rounded-full px-6 sm:w-auto">{t('nav.register')}</Button>
        {/if}
        <Button href="/docs" size="lg" variant={data.signupEnabled ? 'ghost' : 'outline'} class="w-full rounded-full px-6 sm:w-auto">{t('landing.hero.cta2')}<Icon name="external-link" size={16} /></Button>
      </div>
      <dl class="mt-10 grid max-w-lg grid-cols-3 divide-x divide-border">
        {#each stats as s (s.k)}
          <div class="px-4 first:ps-0">
            <dt class="text-2xl font-semibold tracking-tight text-foreground">{s.value}</dt>
            <dd class="mt-1 text-xs text-muted-foreground">{t(`landing.hero.${s.k}`)}</dd>
          </div>
        {/each}
      </dl>
    </div>

    <!-- dashboard preview, drawn from tokens only: a shell with rail, header, KPI tiles and a chart -->
    <figure class="relative mx-auto w-full max-w-md md:max-w-none">
      <div class="pointer-events-none absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-primary/15 via-accent to-transparent blur-2xl" aria-hidden="true"></div>
      <div class="relative overflow-hidden rounded-2xl border bg-card shadow-lg" aria-hidden="true">
        <div class="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
          <span class="h-2.5 w-2.5 rounded-full bg-destructive/60"></span>
          <span class="h-2.5 w-2.5 rounded-full bg-warning/70"></span>
          <span class="h-2.5 w-2.5 rounded-full bg-success/70"></span>
          <span class="ms-3 h-2 w-40 rounded-full bg-muted-foreground/20"></span>
        </div>
        <div class="grid grid-cols-[3rem_1fr] sm:grid-cols-[4rem_1fr]">
          <div class="flex flex-col items-center gap-3 border-e bg-muted/30 py-4 text-muted-foreground">
            <span class="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"><Icon name="dashboard" size={14} /></span>
            <Icon name="users" size={16} />
            <Icon name="building" size={16} />
            <Icon name="chart-bar" size={16} />
            <Icon name="sparkles" size={16} />
            <Icon name="settings" size={16} />
          </div>
          <div class="p-4 sm:p-5">
            <div class="flex items-center justify-between">
              <span class="h-2.5 w-24 rounded-full bg-foreground/70"></span>
              <span class="flex items-center gap-2">
                <span class="h-6 w-6 rounded-full bg-accent"></span>
                <span class="h-6 w-6 rounded-full bg-primary/30"></span>
              </span>
            </div>
            <div class="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
              <div class="rounded-xl border bg-background p-3"><span class="block h-1.5 w-10 rounded-full bg-muted-foreground/30"></span><span class="mt-2 block h-3 w-14 rounded-full bg-foreground/70"></span><span class="mt-2 block h-1.5 w-8 rounded-full bg-success/60"></span></div>
              <div class="rounded-xl border bg-background p-3"><span class="block h-1.5 w-10 rounded-full bg-muted-foreground/30"></span><span class="mt-2 block h-3 w-12 rounded-full bg-foreground/70"></span><span class="mt-2 block h-1.5 w-8 rounded-full bg-primary/60"></span></div>
              <div class="rounded-xl border bg-background p-3"><span class="block h-1.5 w-10 rounded-full bg-muted-foreground/30"></span><span class="mt-2 block h-3 w-16 rounded-full bg-foreground/70"></span><span class="mt-2 block h-1.5 w-8 rounded-full bg-warning/70"></span></div>
            </div>
            <div class="mt-3 grid gap-3 sm:grid-cols-[1.4fr_1fr]">
              <div class="rounded-xl border bg-background p-3">
                <span class="block h-1.5 w-16 rounded-full bg-muted-foreground/30"></span>
                <div class="mt-3 flex h-24 items-end gap-1.5 sm:h-28">
                  {#each bars as h, i (i)}
                    <span class={`flex-1 rounded-t-sm ${i === bars.length - 1 ? 'bg-primary' : 'bg-primary/35'}`} style={`height:${h}%`}></span>
                  {/each}
                </div>
              </div>
              <div class="flex flex-col gap-2 rounded-xl border bg-background p-3">
                <span class="block h-1.5 w-12 rounded-full bg-muted-foreground/30"></span>
                <span class="flex items-center gap-2"><span class="h-5 w-5 rounded-full bg-primary/40"></span><span class="h-1.5 flex-1 rounded-full bg-muted-foreground/25"></span></span>
                <span class="flex items-center gap-2"><span class="h-5 w-5 rounded-full bg-success/40"></span><span class="h-1.5 flex-1 rounded-full bg-muted-foreground/25"></span></span>
                <span class="flex items-center gap-2"><span class="h-5 w-5 rounded-full bg-warning/50"></span><span class="h-1.5 flex-1 rounded-full bg-muted-foreground/25"></span></span>
                <span class="mt-auto flex items-center gap-2 rounded-lg bg-primary/10 p-2 text-primary"><Icon name="sparkles" size={14} /><span class="h-1.5 flex-1 rounded-full bg-primary/40"></span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption class="sr-only">{t('landing.preview.caption')}</figcaption>
    </figure>
  </div>
</section>

<!-- pillars strip: the five product goals -->
<section class="border-y bg-card/60" aria-labelledby="pillars-title">
  <h2 id="pillars-title" class="sr-only">{t('landing.pillars.title')}</h2>
  <ul class="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-2 lg:grid-cols-5">
    {#each pillars as p (p.k)}
      <li class="flex gap-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon name={p.icon} size={20} /></span>
        <div><h3 class="font-semibold text-foreground">{t(`landing.pillars.${p.k}`)}</h3><p class="mt-0.5 text-sm text-muted-foreground">{t(`landing.pillars.${p.k}.text`)}</p></div>
      </li>
    {/each}
  </ul>
</section>

<!-- features -->
<section id="features-container" class="mx-auto max-w-6xl px-4 py-20" aria-labelledby="features-title">
  <div class="max-w-2xl">
    <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">{t('landing.features.eyebrow')}</p>
    <h2 id="features-title" class="mt-3 text-3xl font-semibold leading-tight tracking-tight">{t('landing.features.title')}</h2>
    <p class="mt-4 text-muted-foreground">{t('landing.features.lead')}</p>
  </div>
  <!-- auto-sliding row, pure CSS (no JS on this page): the list is drawn twice so the loop is
       seamless; the second copy is hidden from assistive tech and dropped under reduced motion -->
  <div class="marquee mt-10" style="--marquee-duration: {features.length * 6}s">
    <ul id="features-items" class="marquee-track">
      {#each [false, true] as copy (copy)}
        {#each features as f (f.k)}
          <li class="marquee-item w-[17rem] rounded-2xl border bg-card p-6 shadow-sm transition-transform hover:-translate-y-0.5 sm:w-80" aria-hidden={copy || undefined} data-copy={copy || undefined}>
            <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon name={f.icon} size={22} /></span>
            <h3 class="mt-5 text-lg font-semibold text-foreground">{t(`landing.features.${f.k}`)}</h3>
            <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`landing.features.${f.k}.text`)}</p>
          </li>
        {/each}
      {/each}
    </ul>
  </div>
</section>

<!-- platform status: build identity + installed modules, straight from the API -->
<section class="bg-muted/40" aria-labelledby="platform-title">
  <div class="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-[1fr_1.4fr] md:items-start">
    <div>
      <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">{t('landing.platform.eyebrow')}</p>
      <h2 id="platform-title" class="mt-3 text-3xl font-semibold leading-tight tracking-tight">{t('landing.platform.title')}</h2>
      <p class="mt-4 text-muted-foreground">{t('landing.platform.lead')}</p>
    </div>
    <div class="rounded-2xl border bg-card p-6 shadow-sm">
      {#if data.api}
        <dl class="grid gap-4 sm:grid-cols-3" data-testid="api-status">
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('landing.platform.api')}</dt>
            <dd class="mt-1 font-medium text-foreground"><code class="text-sm">{data.api.name}@{data.api.version}</code></dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('landing.platform.dialect')}</dt>
            <dd class="mt-1 font-medium text-foreground"><code class="text-sm">{data.api.dialect}</code></dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('landing.platform.commit')}</dt>
            <dd class="mt-1 font-medium text-foreground"><code class="text-sm">{data.api.commit.slice(0, 12)}</code></dd>
          </div>
        </dl>
        <h3 class="mt-8 flex items-center justify-between text-sm font-semibold text-foreground">{t('landing.platform.modules')}<span class="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{data.api.modules.length}</span></h3>
        {#if data.api.modules.length}
          <ul class="mt-3 grid gap-3 sm:grid-cols-2" data-testid="landing-modules">
            {#each data.api.modules as m (m.ns)}
              <li class="flex items-center gap-3 rounded-xl border bg-background p-3">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Icon name="puzzle" size={18} /></span>
                <div class="min-w-0">
                  <p class="truncate font-medium text-foreground">{m.name} <span class="text-muted-foreground">v{m.version}</span></p>
                  <p class="truncate text-xs text-muted-foreground"><code>{m.ns}</code> · {t('landing.platform.source')} {m.source}</p>
                </div>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="mt-3 text-sm text-muted-foreground">{t('landing.platform.modules_empty')}</p>
        {/if}
      {:else}
        <p class="flex items-center gap-3 text-foreground" data-testid="api-status" role="status">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning"><Icon name="warning" size={18} /></span>
          <span>{t('landing.api_unreachable')} <span class="text-muted-foreground">({data.apiError ?? '—'})</span></span>
        </p>
      {/if}
    </div>
  </div>
</section>

<!-- developer workflow -->
<section class="mx-auto max-w-6xl px-4 py-20" aria-labelledby="workflow-title">
  <div class="max-w-2xl">
    <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">{t('landing.workflow.eyebrow')}</p>
    <h2 id="workflow-title" class="mt-3 text-3xl font-semibold leading-tight tracking-tight">{t('landing.workflow.title')}</h2>
    <p class="mt-4 text-muted-foreground">{t('landing.workflow.lead')}</p>
  </div>
  <ol class="mt-10 grid gap-5 md:grid-cols-3">
    {#each steps as s, i (s.k)}
      <li class="flex flex-col rounded-2xl border bg-card p-6 shadow-sm">
        <span class="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
        <h3 class="mt-5 text-lg font-semibold text-foreground">{t(`landing.workflow.${s.k}`)}</h3>
        <p class="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{t(`landing.workflow.${s.k}.text`)}</p>
        <pre class="mt-5 whitespace-pre-wrap break-words rounded-xl border bg-muted/60 p-3 text-xs leading-relaxed text-foreground" dir="ltr"><code>{s.cmd}</code></pre>
      </li>
    {/each}
  </ol>
</section>

<!-- closing call to action -->
<section class="mx-auto max-w-6xl px-4 pb-20" aria-labelledby="cta-title">
  <div class="relative overflow-hidden rounded-3xl border bg-primary px-6 py-12 text-primary-foreground shadow-sm md:px-12">
    <div class="pointer-events-none absolute -end-20 -top-20 h-64 w-64 rounded-full bg-primary-foreground/10 blur-3xl" aria-hidden="true"></div>
    <div class="relative grid gap-8 md:grid-cols-[1.4fr_1fr] md:items-center">
      <div>
        <h2 id="cta-title" class="text-3xl font-semibold tracking-tight">{t('landing.cta.title')}</h2>
        <p class="mt-3 max-w-xl text-primary-foreground/85">{t('landing.cta.lead')}</p>
      </div>
      <div class="flex flex-col gap-3 sm:flex-row md:justify-end">
        <Button href="/auth/login" size="lg" variant="secondary" class="w-full rounded-full px-6 sm:w-auto"><Icon name="login" size={18} />{t('nav.login')}</Button>
        <Button href="/docs" size="lg" variant="outline" class="w-full rounded-full border-primary-foreground/40 bg-transparent px-6 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground sm:w-auto">{t('landing.hero.cta2')}</Button>
      </div>
    </div>
  </div>
  <p class="mt-6 text-center text-xs text-muted-foreground"><small>request {data.requestId}</small></p>
</section>
