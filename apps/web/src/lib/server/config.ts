import type { RequestEvent } from '@sveltejs/kit';
import { api } from '$lib/api/client';

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
  readonly ok: boolean;
}

const DEFAULTS: Record<string, unknown> = {
  'app.name': 'Dashboard',
  'app.landing_route': '/m/example',
  'app.home_route': '/dashboard',
  'app.default_theme': 'base',
  'app.allowed_themes': [],
  'app.default_locale': 'id',
};

export async function loadPublicConfig(
  event: RequestEvent,
  clientId: string | null,
): Promise<PublicConfig> {
  const client = api({ requestId: event.locals.requestId, clientId });
  try {
    const [cfg, mods] = await Promise.all([
      client.v1.configuration.public.get(),
      client.v1.module.enabled.get(),
    ]);
    const values = cfg.data?.success ? { ...DEFAULTS, ...cfg.data.data } : DEFAULTS;
    const enabled = mods.data?.success ? new Set(mods.data.data.map((m) => m.ns)) : null;
    return { values, enabledModules: enabled ?? new Set(), ok: !!cfg.data?.success };
  } catch {
    return { values: DEFAULTS, enabledModules: new Set(), ok: false };
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
