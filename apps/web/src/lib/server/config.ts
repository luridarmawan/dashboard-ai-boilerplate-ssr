import { modules } from '@core/module-kit/registry';
import type { ThemeManifest } from '@core/ui-theme';
import type { RequestEvent } from '@sveltejs/kit';
import { api } from '$lib/api/client';
import { sessionCookieHeader } from './session.ts';

/**
 * Runtime configuration for ONE request (PRD E-2, E-4, Decision I): the PUBLIC values of the
 * active tenant (global fallback) plus the modules enabled for it (G-8). Read from the API on
 * every request — the API keeps them behind its versioned cache (E-5), so a change made on any
 * instance is visible here on the next request, without restart. Failure degrades to defaults:
 * the app must render even when the configuration cannot be read (F-6).
 */
export interface PublicConfig {
  readonly values: Readonly<Record<string, unknown>>;
  readonly enabledModules: ReadonlySet<string>;
  /** Admin-assembled themes usable by this tenant (L-24), with the CSS to inject for the active one. */
  readonly customThemes: readonly { manifest: ThemeManifest; css: string }[];
  readonly ok: boolean;
}

const DEFAULTS: Record<string, unknown> = {
  'app.name': 'Dashboard',
  'app.landing_route': '/example',
  'app.home_route': '/dashboard',
  'app.default_theme': 'base',
  'app.allowed_themes': [],
  'app.default_locale': 'id',
};

/** Without an answer from the API we cannot know module state; installed modules stay reachable (F-6). */
const ALL_MODULES = () => new Set(modules.map((m) => m.ns));

export async function loadPublicConfig(
  event: RequestEvent,
  clientId: string | null,
): Promise<PublicConfig> {
  // With the session cookie the API resolves the SAME tenant the user is in; anonymous requests may
  // still name a tenant (public values are public) — the API validates it exists.
  const client = api({
    requestId: event.locals.requestId,
    clientId,
    cookie: sessionCookieHeader(event.cookies),
  });
  try {
    const [cfg, mods, custom] = await Promise.all([
      client.v1.configuration.public.get(),
      client.v1.module.enabled.get(),
      client.v1.themes.custom.get(),
    ]);
    const values = cfg.data?.success ? { ...DEFAULTS, ...cfg.data.data } : DEFAULTS;
    const enabled = mods.data?.success ? new Set(mods.data.data.map((m) => m.ns)) : null;
    const customThemes = custom.data?.success
      ? custom.data.data.map((c) => ({
          manifest: {
            id: c.id,
            name: c.name,
            description: c.description,
            tokens: '',
            icons: c.icons,
            layouts: c.layouts as ThemeManifest['layouts'],
            module: 'core',
            custom: true,
          } satisfies ThemeManifest,
          css: c.css,
        }))
      : [];
    return {
      values,
      enabledModules: enabled ?? ALL_MODULES(),
      customThemes,
      ok: !!cfg.data?.success,
    };
  } catch {
    return { values: DEFAULTS, enabledModules: ALL_MODULES(), customThemes: [], ok: false };
  }
}

export function cfgString(c: PublicConfig, key: string, fallback = ''): string {
  const v = c.values[key];
  return typeof v === 'string' && v !== '' ? v : fallback;
}
export function cfgList(c: PublicConfig, key: string): string[] {
  const v = c.values[key];
  return Array.isArray(v) ? v.map(String) : [];
}
export function cfgBool(c: PublicConfig, key: string): boolean | null {
  const v = c.values[key];
  return typeof v === 'boolean' ? v : null;
}
