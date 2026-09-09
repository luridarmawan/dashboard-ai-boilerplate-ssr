import { env } from '$env/dynamic/private';

/**
 * Deploy-time branding copy, set once in `.env` / `.env.prod` and applied on top of the active
 * locale's catalogue (K-2):
 *
 *   APP_LANDING_TITLE → `landing.title`  headline of the built-in landing page (and the API title)
 *   APP_LANDING_LEAD  → `landing.lead`   the line under it, shown in the public footer
 *   APP_FOOTER_TITLE  → `shell.footer`   the footer line of every shell
 *
 * One value per key for every language: a self-hoster's product name is not translated. These
 * three are branding rather than runtime settings — they must be right in the FIRST HTML a
 * visitor sees, before any database is reachable (F-6) — so they live in the environment while
 * everything an admin may change stays in `configurations` (E-6). Unset or blank = the
 * translated default.
 */
const OVERRIDES: readonly (readonly [key: string, variable: string])[] = [
  ['landing.title', 'APP_LANDING_TITLE'],
  ['landing.lead', 'APP_LANDING_LEAD'],
  ['shell.footer', 'APP_FOOTER_TITLE'],
];

export function brandedMessages(
  messages: Readonly<Record<string, string>>,
): Record<string, string> {
  const out = { ...messages };
  for (const [key, variable] of OVERRIDES) {
    const value = env[variable]?.trim();
    if (value) out[key] = value;
  }
  return out;
}
