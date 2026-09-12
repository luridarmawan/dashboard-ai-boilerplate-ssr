import type { MessageKey } from '@core/i18n';

/**
 * The wording of the online indicator (D-5), kept OUT of the component on purpose.
 *
 * `Presence.svelte` lives in `lib/components`, which an anonymous visitor can reach, so every key
 * used inside it would have to ship in the landing page's i18n payload (see i18n-payload.test.ts).
 * Presence is a dashboard idea — who is signed in right now — so its four strings are built here,
 * by the dashboard pages that render it, and the component only draws what it is handed.
 */
export interface PresenceLike {
  readonly online: boolean;
  /** ISO timestamp of the newest session touch, live or not; null when nothing is left to show. */
  readonly lastSeenAt?: string | null;
}

/** Coarse relative time — a presence column is scanned, not read to the second. */
function ago(iso: string, locale: string, t: (key: MessageKey) => string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return t('presence.just_now');
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  return new Date(then).toLocaleDateString(locale);
}

export function presenceText(
  row: PresenceLike,
  locale: string,
  t: {
    (key: MessageKey): string;
    (key: MessageKey, vars: Record<string, string | number>): string;
  },
): string {
  if (row.online) return t('presence.online');
  return row.lastSeenAt
    ? t('presence.last_seen', { when: ago(row.lastSeenAt, locale, t) })
    : t('presence.never');
}
