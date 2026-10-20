import type { RequestEvent } from '@sveltejs/kit';
import { ANALYTICS_EVENT_COOKIE, type AnalyticsConfig } from '$lib/analytics/core';
import { cfgBool, cfgString, type PublicConfig } from './config.ts';

const secure = (event: RequestEvent) =>
  event.url.protocol === 'https:' || process.env.NODE_ENV === 'production';

/** Same shape the settings registry enforces on save; checked again so a bad row cannot leak into a URL. */
const GA_ID_RE = /^G-[A-Z0-9]{4,20}$/;

/**
 * The analytics settings of the request's tenant (Settings → Analytics) as the browser needs them,
 * or null when analytics cannot run: switched off, no measurement id, or neither area tracked.
 */
export function analyticsConfig(c: PublicConfig): AnalyticsConfig | null {
  if (cfgBool(c, 'analytics.enabled') !== true) return null;
  if (cfgString(c, 'analytics.provider', 'google') !== 'google') return null;
  const id = cfgString(c, 'analytics.ga_measurement_id');
  if (!GA_ID_RE.test(id)) return null;
  const trackPublic = cfgBool(c, 'analytics.track_public') ?? true;
  const trackDashboard = cfgBool(c, 'analytics.track_dashboard') ?? true;
  if (!trackPublic && !trackDashboard) return null;
  return {
    provider: 'google',
    id,
    trackPublic,
    trackDashboard,
    requireConsent: cfgBool(c, 'analytics.require_consent') ?? true,
  };
}

/**
 * Leave a sign-in or sign-up for the browser to report on the page the action redirects to — the
 * action itself answers with a redirect, so no client code runs in between. Only when dashboard
 * tracking is on: that is where the redirect lands.
 */
export function flagAnalyticsEvent(event: RequestEvent, name: 'login' | 'sign_up'): void {
  if (!analyticsConfig(event.locals.config)?.trackDashboard) return;
  event.cookies.set(ANALYTICS_EVENT_COOKIE, name, {
    path: '/',
    maxAge: 300,
    httpOnly: false,
    sameSite: 'lax',
    secure: secure(event),
  });
}
